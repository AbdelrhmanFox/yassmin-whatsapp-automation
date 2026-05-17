/**
 * Single API router for Vercel (Hobby plan: max 12 serverless functions).
 * Local dev uses dashboard/server.js instead.
 */
const { supabaseConfigured, usePaymentsEdge, PAYMENTS_FUNCTION_URL } = require('./supabase');
const {
  listPayments,
  updatePaymentDone,
  createPayment,
  listProducts,
  getProvider
} = require('./payments-store');
const { sendPaymentWhatsAppNow } = require('./send-payment-whatsapp');
const {
  listThreads,
  listPausedChats,
  setRoutingMode,
  ingestMessage,
  ingestPausedChat,
  listThreadMessages
} = require('./messages-store');
const { getBotSettings, updateBotSettings } = require('./bot-settings-store');
const {
  listKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword
} = require('./keywords-store');
const { sendJson, isAuthorized, DISABLE_AUTH } = require('../../api/_helpers');

const CONTROL_WEBHOOK_URL = process.env.CONTROL_WEBHOOK_URL || '';
const METRICS_WEBHOOK_URL = process.env.METRICS_WEBHOOK_URL || '';
const actionHistory = [];

const FALLBACK_PRODUCTS = [
  { product_code: 'inner_compass', label_ar: 'كتاب بوصلتك الداخلية', pdf_url: '' },
  { product_code: 'voltaren_social', label_ar: 'كتاب فولتارين السوشيال ميديا', pdf_url: '' }
];
const FORM_ENABLED = String(process.env.PUBLIC_FORM_ENABLED ?? 'true').toLowerCase() !== 'false';
const MAX_RECEIPT_B64 = 4 * 1024 * 1024;

function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        return {};
      }
    }
    return req.body;
  }
  return {};
}

function resolvePathname(req) {
  const segs = req.query?.path;
  if (segs) {
    const parts = (Array.isArray(segs) ? segs : [segs])
      .flatMap((p) => String(p).split('/'))
      .map((p) => p.trim())
      .filter(Boolean);
    return '/api/' + parts.map((p) => decodeURIComponent(p)).join('/');
  }
  if (req.query?.phone != null && String(req.url || '').includes('/chats/')) {
    return `/api/chats/${decodeURIComponent(String(req.query.phone))}`;
  }
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return '/api';
  }
}

function resolveSearch(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').search;
  } catch {
    return '';
  }
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    status: 'running',
    platform: 'vercel',
    databaseProvider: getProvider(),
    supabaseConnected: supabaseConfigured(),
    supabaseEdgePayments: usePaymentsEdge(),
    supabasePaymentsFunctionUrl: Boolean(PAYMENTS_FUNCTION_URL),
    supabaseSchema: process.env.SUPABASE_SCHEMA || 'yassmin',
    authDisabled: DISABLE_AUTH,
    paymentSendMode: 'vercel-evolution',
    evolutionConfigured: Boolean(process.env.EVOLUTION_API_KEY),
    paymentSendWebhookConfigured: Boolean(process.env.N8N_PAYMENT_SEND_WEBHOOK_URL),
    now: new Date().toISOString()
  });
}

function handleHistory(res) {
  sendJson(res, 200, { ok: true, items: actionHistory });
}

function summarizeRows(rows) {
  const now = Date.now();
  const metrics = { total: rows.length, sent: 0, failed: 0, deadLetter: 0, retryDueNow: 0, avgLatencyMs: 0 };
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
    sendJson(res, 200, { ok: true, metrics: summarizeRows(rows), sourceCount: rows.length, raw: data });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'metrics_request_failed' });
  }
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
    const payload = parseBody(req);
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

async function handlePublicProducts(res) {
  try {
    let products = await listProducts();
    if (!products.length) products = FALLBACK_PRODUCTS;
    sendJson(res, 200, { ok: true, products });
  } catch {
    sendJson(res, 200, { ok: true, products: FALLBACK_PRODUCTS, degraded: true });
  }
}

async function handlePublicPayment(req, res) {
  if (!FORM_ENABLED) {
    sendJson(res, 503, { ok: false, error: 'form_disabled' });
    return;
  }
  try {
    const body = parseBody(req);
    if (String(body.website || '').trim()) {
      sendJson(res, 400, { ok: false, error: 'spam_rejected' });
      return;
    }
    if (body.receipt_base64 && body.receipt_base64.length > MAX_RECEIPT_B64) {
      sendJson(res, 413, { ok: false, error: 'receipt_too_large' });
      return;
    }
    const data = await createPayment(body);
    sendJson(res, 201, {
      ok: true,
      message:
        'تم استلام طلبك بنجاح. سيتم مراجعة الدفع وإرسال المنتج على واتساب بعد التأكيد.',
      form_timestamp: data.form_timestamp
    });
  } catch (error) {
    if (error.code === 'VALIDATION') {
      sendJson(res, 422, { ok: false, error: error.message, details: error.details });
      return;
    }
    if (error.code === 'DUPLICATE') {
      sendJson(res, 409, { ok: false, error: 'duplicate_submission' });
      return;
    }
    if (error.code === 'CONFIG') {
      sendJson(res, 503, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 500, { ok: false, error: error.message || 'submit_failed' });
  }
}

async function handleApiRequest(req, res) {
  const pathname = resolvePathname(req);
  const search = resolveSearch(req);
  const url = new URL(pathname + search, 'http://localhost');

  if (req.method === 'GET' && pathname === '/api/health') {
    handleHealth(res);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/control') {
    handleHistory(res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/control') {
    await handleControl(req, res);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/metrics') {
    await handleMetrics(res);
    return;
  }
  if (pathname === '/api/public/products' && req.method === 'GET') {
    await handlePublicProducts(res);
    return;
  }
  if (pathname === '/api/public/payment' && req.method === 'POST') {
    await handlePublicPayment(req, res);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/payments') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const data = await listPayments({
        q: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || 'all'
      });
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, error.code === 'NOT_FOUND' ? 404 : 500, { ok: false, error: error.message });
    }
    return;
  }
  if (req.method === 'POST' && pathname === '/api/payment-send-now') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const body = parseBody(req);
    const id = body.form_timestamp || body.id || url.searchParams.get('id') || '';
    const formTimestamp = decodeURIComponent(String(id));
    try {
      const result = await sendPaymentWhatsAppNow(formTimestamp);
      sendJson(res, 200, {
        ok: true,
        message: 'تم إرسال رسالة التأكيد + PDF على واتساب',
        ...result
      });
    } catch (error) {
      if (error.code === 'CONFIG') {
        sendJson(res, 503, { ok: false, error: error.message, hint: error.hint });
        return;
      }
      sendJson(res, 422, { ok: false, error: error.message, details: error.details });
    }
    return;
  }
  if (req.method === 'PATCH' && pathname === '/api/payments') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const body = parseBody(req);
    const id = url.searchParams.get('id') || url.searchParams.get('timestamp') || body.id || '';
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'missing_payment_id' });
      return;
    }
    try {
      const data = await updatePaymentDone(decodeURIComponent(id), Boolean(body.done), {
        resetWhatsapp: body.resetWhatsapp !== false
      });
      sendJson(res, 200, {
        ok: true,
        message: body.done ? 'تم تفعيل تأكيد الدفع' : 'تم إلغاء تأكيد الدفع',
        stats: data.stats,
        rows: data.rows
      });
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 404 : error.code === 'SCHEMA' ? 422 : 500;
      sendJson(res, code, { ok: false, error: error.message });
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/messages') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const data = await listThreads({
        q: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || 'all'
      });
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/paused-chats') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      sendJson(res, 200, await listPausedChats());
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }
  if (pathname === '/api/bot-settings') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, await getBotSettings());
        return;
      }
      if (req.method === 'PATCH') {
        sendJson(res, 200, await updateBotSettings(parseBody(req)));
        return;
      }
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (pathname === '/api/keywords') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, await listKeywords());
        return;
      }
      const body = parseBody(req);
      if (req.method === 'POST') {
        sendJson(res, 201, await createKeyword(body));
        return;
      }
      const kid = url.searchParams.get('id') || body.id;
      if (req.method === 'PATCH') {
        if (!kid) {
          sendJson(res, 400, { ok: false, error: 'missing_keyword_id' });
          return;
        }
        sendJson(res, 200, await updateKeyword(kid, body));
        return;
      }
      if (req.method === 'DELETE') {
        if (!kid) {
          sendJson(res, 400, { ok: false, error: 'missing_keyword_id' });
          return;
        }
        sendJson(res, 200, await deleteKeyword(kid));
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
  if (req.method === 'GET' && pathname === '/api/messages-thread') {
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
      sendJson(res, 200, await listThreadMessages(decodeURIComponent(phone)));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }
  const chatPatch = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === 'PATCH' && chatPatch) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const body = parseBody(req);
      const mode = body.mode === 'human' ? 'human' : 'auto';
      const data = await setRoutingMode(decodeURIComponent(chatPatch[1]), mode, {
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
  if (req.method === 'POST' && pathname === '/api/webhooks/n8n/message') {
    try {
      sendJson(res, 200, await ingestMessage(parseBody(req)));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }
  if (req.method === 'POST' && pathname === '/api/webhooks/n8n/paused-chat') {
    try {
      sendJson(res, 200, await ingestPausedChat(parseBody(req)));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found', path: pathname });
}

module.exports = { handleApiRequest, resolvePathname };
