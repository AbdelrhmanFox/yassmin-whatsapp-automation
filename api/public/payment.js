const { createPayment } = require('../../dashboard/lib/payments-store');
const { sendJson } = require('../_helpers');

const FORM_ENABLED = String(process.env.PUBLIC_FORM_ENABLED ?? 'true').toLowerCase() !== 'false';
const MAX_RECEIPT_B64 = 4 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!FORM_ENABLED) {
    sendJson(res, 503, { ok: false, error: 'form_disabled' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (norm(body.website)) {
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
      message: 'تم استلام طلبك بنجاح. سيتم مراجعة الدفع وإرسال المنتج على واتساب بعد التأكيد.',
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
};

function norm(s) {
  return String(s ?? '').trim();
}
