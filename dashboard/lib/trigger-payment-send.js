const WEBHOOK_URL = process.env.N8N_PAYMENT_SEND_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || '';

const PRECHECK_MESSAGES = {
  payment_not_confirmed: 'يجب تفعيل «تم التأكيد» قبل الإرسال',
  already_sent: 'تم إرسال واتساب مسبقاً لهذا الطلب',
  dead_letter: 'هذا الطلب في حالة dead letter',
  missing_phone: 'رقم واتساب غير موجود',
  invalid_phone: 'صيغة رقم واتساب غير صحيحة',
  human_handoff_paused: 'الرقم موقوف للرد البشري — لا يُرسل تأكيد تلقائي',
  payment_not_found: 'لم يُعثر على الطلب',
  missing_form_timestamp: 'معرّف الطلب ناقص',
  unauthorized: 'رفض من n8n (تحققي من N8N_WEBHOOK_SECRET)'
};

function humanizePrecheck(code) {
  return PRECHECK_MESSAGES[code] || code || 'فشل الإرسال';
}

async function triggerPaymentSendNow(formTimestamp) {
  const key = String(formTimestamp ?? '').trim();
  if (!key) {
    const err = new Error('missing_form_timestamp');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!WEBHOOK_URL) {
    const err = new Error('missing_N8N_PAYMENT_SEND_WEBHOOK_URL');
    err.code = 'CONFIG';
    err.hint =
      'استوردي payment-send-now-n8n-workflow.json في n8n وفعّلي الوركفلو، ثم ضيفي رابط الـ Webhook في Vercel.';
    throw err;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (WEBHOOK_SECRET) headers['x-n8n-secret'] = WEBHOOK_SECRET;

  const startedAt = Date.now();
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ form_timestamp: key })
  });

  let data = {};
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  const latencyMs = Date.now() - startedAt;
  const sent = Boolean(data.sent) || (data.ok === true && !data.error);
  const errorCode = data.error || data.precheck_error || '';

  if (!res.ok || data.ok === false || data.sent === false) {
    const err = new Error(humanizePrecheck(errorCode) || data.message || `n8n_${res.status}`);
    err.code = 'SEND_FAILED';
    err.details = { status: res.status, error: errorCode, latencyMs, upstream: data };
    throw err;
  }

  return {
    ok: true,
    sent: true,
    form_timestamp: key,
    latencyMs,
    upstream: data
  };
}

module.exports = { triggerPaymentSendNow, humanizePrecheck };
