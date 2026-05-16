const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { supabaseConfigured } = require('./lib/supabase');
const {
  listPayments,
  updatePaymentDone,
  createPayment,
  listProducts,
  getProvider
} = require('./lib/payments-store');
const { sendPaymentWhatsAppNow } = require('./lib/send-payment-whatsapp');
const {
  listThreads,
  listPausedChats,
  setRoutingMode,
  ingestMessage,
  ingestPausedChat,
  listThreadMessages
} = require('./lib/messages-store');
const {
  listKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword
} = require('./lib/keywords-store');

const PORT = Number(process.env.DASHBOARD_PORT || 8088);
const ADMIN_TOKEN = process.env.DASHBOARD_ADMIN_TOKEN || 'change-me';
const CONTROL_WEBHOOK_URL = process.env.CONTROL_WEBHOOK_URL || '';
const METRICS_WEBHOOK_URL = process.env.METRICS_WEBHOOK_URL || '';
const DISABLE_AUTH = String(process.env.DASHBOARD_DISABLE_AUTH || 'true').toLowerCase() === 'true';
const PUBLIC_DIR = path.join(__dirname, 'public');
const actionHistory = [];

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    const ext = path.extname(filePath);
    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.js'
            ? 'application/javascript; charset=utf-8'
            : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (DISABLE_AUTH) return true;
  const token = req.headers['x-admin-token'];
  return token && token === ADMIN_TOKEN;
}

async function handleControl(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  if (!CONTROL_WEBHOOK_URL) {
    sendJson(res, 400, { ok: false, error: 'missing_CONTROL_WEBHOOK_URL' });
    return;
  }
  try {
    const payload = await readBody(req);
    const startedAt = Date.now();
    const response = await fetch(CONTROL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    const historyItem = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      action: payload.action || 'unknown',
      payload,
      status: response.status,
      ok: response.ok,
      latencyMs: Date.now() - startedAt,
      upstream: data
    };
    actionHistory.unshift(historyItem);
    if (actionHistory.length > 50) actionHistory.pop();
    sendJson(res, response.status, { ok: response.ok, historyItem, upstream: data });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'control_request_failed' });
  }
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    status: 'running',
    databaseProvider: getProvider(),
    supabaseConnected: supabaseConfigured(),
    controlWebhookConfigured: Boolean(CONTROL_WEBHOOK_URL),
    metricsWebhookConfigured: Boolean(METRICS_WEBHOOK_URL),
    authDisabled: DISABLE_AUTH,
    now: new Date().toISOString()
  });
}

function handleHistory(res) {
  sendJson(res, 200, { ok: true, items: actionHistory });
}

function summarizeRows(rows) {
  const now = Date.now();
  const metrics = {
    total: rows.length,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    retryDueNow: 0,
    avgLatencyMs: 0
  };
  let latencySum = 0;
  let latencyCount = 0;

  for (const row of rows) {
    const status = String(row.whatsapp_status || '').toLowerCase();
    const deadLetter =
      String(row.dead_letter || '').toLowerCase() === 'true' || status === 'dead_letter';
    const nextRetryAt = row.next_retry_at ? new Date(row.next_retry_at).getTime() : 0;
    const latency = Number(row.latency_ms);

    if (status === 'sent') metrics.sent += 1;
    if (status === 'failed') metrics.failed += 1;
    if (deadLetter) metrics.deadLetter += 1;
    if (status === 'failed' && nextRetryAt && nextRetryAt <= now) metrics.retryDueNow += 1;

    if (Number.isFinite(latency) && latency >= 0) {
      latencySum += latency;
      latencyCount += 1;
    }
  }

  metrics.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
  return metrics;
}

async function handleMetrics(res) {
  if (!METRICS_WEBHOOK_URL) {
    try {
      const data = await listPayments();
      sendJson(res, 200, {
        ok: true,
        metrics: {
          total: data.stats.total,
          sent: data.stats.sent,
          failed: data.stats.failed,
          deadLetter: data.stats.dead_letter,
          retryDueNow: data.stats.awaiting_whatsapp,
          avgLatencyMs: 0
        },
        source: 'supabase',
        stats: data.stats
      });
      return;
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message || 'supabase_unavailable' });
      return;
    }
  }
  try {
    const response = await fetch(METRICS_WEBHOOK_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data) ? data : [];
    const metrics = summarizeRows(rows);
    sendJson(res, 200, { ok: true, metrics, sourceCount: rows.length, raw: data });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'metrics_request_failed' });
  }
}

async function handlePaymentsList(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || 'all';
    const data = await listPayments({ q, status });
    sendJson(res, 200, data);
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    sendJson(res, status, {
      ok: false,
      error: error.message,
      hint: !supabaseConfigured()
        ? 'اضبطي SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY أو روابط دوال Edge في البيئة'
        : undefined
    });
  }
}

async function handlePaymentPatch(req, res, timestamp) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const body = await readBody(req);
    const done = Boolean(body.done);
    const resetWhatsapp = body.resetWhatsapp !== false;
    const data = await updatePaymentDone(decodeURIComponent(timestamp), done, { resetWhatsapp });
    sendJson(res, 200, {
      ok: true,
      message: done ? 'تم تفعيل تأكيد الدفع' : 'تم إلغاء تأكيد الدفع',
      stats: data.stats,
      rows: data.rows
    });
  } catch (error) {
    const code = error.code === 'NOT_FOUND' ? 404 : error.code === 'SCHEMA' ? 422 : 500;
    sendJson(res, code, { ok: false, error: error.message });
  }
}

async function handlePaymentSendNow(req, res, timestamp) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  const formTimestamp = decodeURIComponent(timestamp);
  try {
    const listed = await listPayments({ q: formTimestamp, status: 'all' });
    const row = (listed.rows || []).find(
      (r) => String(r.id || r.timestamp || '').trim() === formTimestamp
    );
    if (!row) {
      sendJson(res, 404, { ok: false, error: 'payment_row_not_found' });
      return;
    }
    if (!row.done) {
      sendJson(res, 422, {
        ok: false,
        error: 'payment_not_confirmed',
        message: 'فعّلي «تم التأكيد» أولاً ثم اضغطي إرسال واتساب الآن'
      });
      return;
    }
    if (String(row.whatsapp_status || '').toLowerCase() === 'sent') {
      sendJson(res, 409, {
        ok: false,
        error: 'already_sent',
        message: 'تم إرسال واتساب مسبقاً لهذا الطلب'
      });
      return;
    }
    const result = await sendPaymentWhatsAppNow(formTimestamp);
    sendJson(res, 200, {
      ok: true,
      message: 'تم إرسال رسالة التأكيد + PDF على واتساب',
      sent: result.sent,
      message_id: result.message_id,
      form_timestamp: formTimestamp,
      latencyMs: result.latencyMs,
      provider: result.provider,
      stats: result.stats,
      rows: result.rows
    });
  } catch (error) {
    if (error.code === 'CONFIG') {
      sendJson(res, 503, { ok: false, error: error.message, hint: error.hint });
      return;
    }
    sendJson(res, 422, {
      ok: false,
      error: error.message,
      details: error.details
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    handleHealth(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/control') {
    handleHistory(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/control') {
    await handleControl(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/metrics') {
    await handleMetrics(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/public/products') {
    try {
      let products = await listProducts();
      if (!products.length) {
        products = [
          { product_code: 'inner_compass', label_ar: 'كتاب بوصلتك الداخلية' },
          { product_code: 'voltaren_social', label_ar: 'كتاب فولتارين السوشيال ميديا' }
        ];
      }
      sendJson(res, 200, { ok: true, products });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/public/payment') {
    try {
      const body = await readBody(req);
      if (String(body.website || '').trim()) {
        sendJson(res, 400, { ok: false, error: 'spam_rejected' });
        return;
      }
      const data = await createPayment(body);
      sendJson(res, 201, {
        ok: true,
        message:
          'تم استلام طلبك بنجاح. سيتم مراجعة الدفع وإرسال المنتج على واتساب بعد التأكيد.',
        form_timestamp: data.form_timestamp
      });
    } catch (e) {
      const code = e.code === 'VALIDATION' ? 422 : e.code === 'DUPLICATE' ? 409 : 500;
      sendJson(res, code, { ok: false, error: e.message, details: e.details });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/payments') {
    await handlePaymentsList(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/payment-send-now') {
    const body = await readBody(req);
    const id = body.form_timestamp || body.id || url.searchParams.get('id') || '';
    await handlePaymentSendNow(req, res, encodeURIComponent(String(id)));
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/payments') {
    const body = await readBody(req);
    const id = url.searchParams.get('id') || url.searchParams.get('timestamp') || body.id || '';
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'missing_payment_id' });
      return;
    }
    await handlePaymentPatch(req, res, id);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const q = url.searchParams.get('q') || '';
      const status = url.searchParams.get('status') || 'all';
      const data = await listThreads({ q, status });
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/paused-chats') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const data = await listPausedChats();
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/keywords') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, await listKeywords());
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        sendJson(res, 201, await createKeyword(body));
        return;
      }
      if (req.method === 'PATCH') {
        const id = url.searchParams.get('id') || '';
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'missing_keyword_id' });
          return;
        }
        const body = await readBody(req);
        sendJson(res, 200, await updateKeyword(id, body));
        return;
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'missing_keyword_id' });
          return;
        }
        sendJson(res, 200, await deleteKeyword(id));
        return;
      }
    } catch (error) {
      const code =
        error.code === 'CONFIG' ? 503 : error.code === 'VALIDATION' ? 422 : error.code === 'NOT_FOUND' ? 404 : 500;
      sendJson(res, code, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages-thread') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const phone = url.searchParams.get('phone') || url.searchParams.get('p') || '';
    if (!phone.trim()) {
      sendJson(res, 400, { ok: false, error: 'missing_phone' });
      return;
    }
    try {
      const data = await listThreadMessages(decodeURIComponent(phone));
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  const chatPatchMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === 'PATCH' && chatPatchMatch) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const body = await readBody(req);
      const mode = body.mode === 'human' ? 'human' : 'auto';
      const data = await setRoutingMode(decodeURIComponent(chatPatchMatch[1]), mode, {
        reason: body.reason || 'dashboard_manual'
      });
      sendJson(res, 200, {
        ok: true,
        message: mode === 'human' ? 'تم التحويل للرد البشري' : 'تم تفعيل الرد التلقائي',
        stats: data.stats,
        threads: data.threads
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/webhooks/n8n/message') {
    try {
      const body = await readBody(req);
      const data = await ingestMessage(body);
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/webhooks/n8n/paused-chat') {
    try {
      const body = await readBody(req);
      const data = await ingestPausedChat(body);
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`\n📊 لوحة التحكم: http://localhost:${PORT}`);
  console.log(`   Supabase: ${supabaseConfigured() ? 'متصل ✓' : 'غير متصل — راجع المفاتيح'}`);
  console.log('');
});
