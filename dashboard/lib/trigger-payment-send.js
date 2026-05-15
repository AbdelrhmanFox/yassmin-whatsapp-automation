const DEFAULT_WEBHOOK_URL = 'https://n8n.growleadpro.com/webhook/yassmin-send-payment';
const WEBHOOK_URL = (process.env.N8N_PAYMENT_SEND_WEBHOOK_URL || DEFAULT_WEBHOOK_URL).trim();
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
  return PRECHECK_MESSAGES[code] || code || '';
}

function n8nFailureMessage(data, status) {
  const msg = String(data?.message || '').trim();
  const hint = String(data?.hint || '').trim();
  if (status === 404 || /not registered/i.test(msg)) {
    return (
      'workflow إرسال الدفع غير مفعّل في n8n — فعّلي workflow على المسار yassmin-send-payment (زر «إرسال الآن» يعمل الآن من Vercel مباشرة بدون n8n)'
    );
  }
  if (msg) return hint ? `${msg} (${hint})` : msg;
  return `فشل الاتصال بـ n8n (HTTP ${status})`;
}

async function triggerPaymentSendNow(formTimestamp) {
  const key = String(formTimestamp ?? '').trim();
  if (!key) {
    const err = new Error('missing_form_timestamp');
    err.code = 'VALIDATION';
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
  const text = (await res.text()).trim();
  if (!text) {
    const err = new Error(
      'استجابة فارغة من n8n — تأكدي أن workflow «إرسال تأكيد الدفع فوراً» مفعّل ومستورد من payment-send-now-n8n-workflow.json'
    );
    err.code = 'SEND_FAILED';
    err.details = { status: res.status, error: 'n8n_empty_response', latencyMs: Date.now() - startedAt };
    throw err;
  }
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error('استجابة غير صالحة من n8n');
    err.code = 'SEND_FAILED';
    err.details = { status: res.status, error: 'n8n_invalid_json', raw: text.slice(0, 500) };
    throw err;
  }

  const latencyMs = Date.now() - startedAt;
  const sent = data.sent === true;
  const errorCode = data.error || data.precheck_error || '';

  if (!res.ok || data.ok === false || !sent) {
    const err = new Error(
      humanizePrecheck(errorCode) || n8nFailureMessage(data, res.status)
    );
    err.code = 'SEND_FAILED';
    err.details = { status: res.status, error: errorCode, latencyMs, upstream: data, webhookUrl: WEBHOOK_URL };
    throw err;
  }

  return {
    ok: true,
    sent,
    form_timestamp: key,
    message_id: data.message_id || '',
    latencyMs,
    upstream: data
  };
}

module.exports = { triggerPaymentSendNow, humanizePrecheck };
