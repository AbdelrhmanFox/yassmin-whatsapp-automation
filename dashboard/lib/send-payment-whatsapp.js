const { listPayments, listProducts, updatePaymentWhatsappStatus } = require('./payments-store');
const { resolveProductPdfUrl } = require('./resolve-product-pdf-url');
const { DASHBOARD_FUNCTION_URL } = require('./supabase');

const FIXED_CONFIRMATION = 'تم تأكيد الدفع.';
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://evolution.growleadpro.com').replace(
  /\/$/,
  ''
);
const EVOLUTION_INSTANCE = (process.env.EVOLUTION_INSTANCE || 'Yas').trim();
const EVOLUTION_API_KEY = (process.env.EVOLUTION_API_KEY || '').trim();

const PRECHECK_MESSAGES = {
  payment_not_confirmed: 'يجب تفعيل «تم التأكيد» قبل الإرسال',
  already_sent: 'تم إرسال واتساب مسبقاً لهذا الطلب',
  dead_letter: 'هذا الطلب في حالة dead letter',
  missing_phone: 'رقم واتساب غير موجود',
  invalid_phone: 'صيغة رقم واتساب غير صحيحة',
  human_handoff_paused: 'الرقم موقوف للرد البشري — لا يُرسل تأكيد تلقائي',
  payment_not_found: 'لم يُعثر على الطلب',
  evolution_not_configured: 'أضيفي EVOLUTION_API_KEY في Vercel (Project → Settings → Environment Variables)'
};

function precheckError(code) {
  const err = new Error(PRECHECK_MESSAGES[code] || code || 'فشل الإرسال');
  err.code = 'SEND_FAILED';
  err.precheck = code;
  return err;
}

function normalizePhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return `20${d.slice(1)}`;
  if (!d.startsWith('20') && d.length === 10) return `20${d}`;
  return d;
}

function buildConfirmationText(productCode, productLabel, products) {
  const pdfUrl = resolveProductPdfUrl(productCode, productLabel, products);
  if (pdfUrl) {
    return `${FIXED_CONFIRMATION}\n\nرابط تحميل الكتاب (PDF أو مجلد Drive):\n${pdfUrl}`;
  }
  return `${FIXED_CONFIRMATION}\n\nلم يُعثر على رابط تحميل لهذا الكتاب؛ سنتواصل معك لاحقًا.`;
}

async function fetchPausedChats() {
  const base = String(DASHBOARD_FUNCTION_URL || '').replace(/\/$/, '');
  if (!base) return [];
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const res = await fetch(`${base}/paused-chats`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return Array.isArray(data.rows) ? data.rows : [];
}

function isPhonePaused(phone, pausedRows) {
  const p = normalizePhone(phone);
  const now = Date.now();
  for (const row of pausedRows) {
    if (normalizePhone(row.phone) !== p) continue;
    if (row.active === false) continue;
    const exp = new Date(row.expires_at).getTime();
    if (Number.isFinite(exp) && exp > now) return true;
  }
  return false;
}

async function evolutionSendText(phone, text) {
  if (!EVOLUTION_API_KEY) {
    throw precheckError('evolution_not_configured');
  }
  const url = `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: EVOLUTION_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ number: phone, text, delay: 1200, linkPreview: false })
  });
  const data = await res.json().catch(() => ({}));
  const messageId =
    data?.key?.id ||
    data?.message?.key?.id ||
    data?.data?.key?.id ||
    data?.messages?.[0]?.key?.id ||
    '';
  if (!res.ok || !messageId) {
    const err = new Error(
      data?.message || data?.error || `evolution_http_${res.status}` || 'evolution_send_failed'
    );
    err.code = 'SEND_FAILED';
    err.details = { status: res.status, evolution: data };
    throw err;
  }
  return { messageId, evolution: data };
}

async function sendPaymentWhatsAppNow(formTimestamp) {
  const key = String(formTimestamp ?? '').trim();
  if (!key) {
    const err = new Error('missing_form_timestamp');
    err.code = 'VALIDATION';
    throw err;
  }

  const listed = await listPayments({ q: key, status: 'all' });
  const row = (listed.rows || []).find((r) => String(r.id || r.timestamp || '').trim() === key);
  if (!row) throw precheckError('payment_not_found');

  const wa = String(row.whatsapp_status || '').toLowerCase();
  if (!row.done) throw precheckError('payment_not_confirmed');
  if (wa === 'sent') throw precheckError('already_sent');
  if (wa === 'dead_letter' || row.dead_letter) throw precheckError('dead_letter');

  const phone = normalizePhone(row.phone);
  if (!phone) throw precheckError('missing_phone');
  if (!/^20\d{10}$/.test(phone)) throw precheckError('invalid_phone');

  const paused = await fetchPausedChats();
  if (isPhonePaused(phone, paused)) throw precheckError('human_handoff_paused');

  const products = await listProducts();
  const confirmationText = buildConfirmationText(row.product_code, row.product_label, products);
  const processedAt = new Date().toISOString();

  const startedAt = Date.now();
  let messageId = '';
  try {
    const sent = await evolutionSendText(phone, confirmationText);
    messageId = sent.messageId;
    await updatePaymentWhatsappStatus(key, {
      whatsapp_status: 'sent',
      whatsapp_last_error: '',
      whatsapp_sent_at: processedAt
    });
  } catch (error) {
    try {
      await updatePaymentWhatsappStatus(key, {
        whatsapp_status: 'failed',
        whatsapp_last_error: String(error.message || 'send_failed').slice(0, 500),
        whatsapp_sent_at: null
      });
    } catch {
      /* ignore patch failure */
    }
    throw error;
  }

  const refreshed = await listPayments();
  return {
    ok: true,
    sent: true,
    form_timestamp: key,
    phone,
    message_id: messageId,
    latencyMs: Date.now() - startedAt,
    provider: 'vercel-evolution',
    rows: refreshed.rows,
    stats: refreshed.stats
  };
}

module.exports = { sendPaymentWhatsAppNow, normalizePhone, buildConfirmationText, resolveProductPdfUrl };
