const { listPayments } = require('../dashboard/lib/payments-store');
const { triggerPaymentSendNow } = require('../dashboard/lib/trigger-payment-send');
const { sendJson, requireAuth } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const rawId = body.form_timestamp || body.id || req.query.id || '';
  const formTimestamp = decodeURIComponent(String(rawId).trim());
  if (!formTimestamp) {
    sendJson(res, 400, { ok: false, error: 'missing_payment_id' });
    return;
  }

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

    const result = await triggerPaymentSendNow(formTimestamp);
    const refreshed = await listPayments();
    const updated = (refreshed.rows || []).find(
      (r) => String(r.id || r.timestamp || '').trim() === formTimestamp
    );
    const wa = String(updated?.whatsapp_status || '').toLowerCase();
    if (wa !== 'sent') {
      sendJson(res, 422, {
        ok: false,
        error: 'whatsapp_not_marked_sent',
        message:
          'واتساب قد يكون أُرسل لكن قاعدة البيانات لم تُحدَّث — راجعي تنفيذ n8n (عقدة Mark Sent / PATCH)',
        upstream: result.upstream,
        latencyMs: result.latencyMs
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      message: 'تم إرسال رسالة التأكيد + PDF على واتساب',
      sent: result.sent,
      message_id: result.message_id,
      form_timestamp: formTimestamp,
      latencyMs: result.latencyMs,
      stats: refreshed.stats,
      rows: refreshed.rows
    });
  } catch (error) {
    if (error.code === 'CONFIG') {
      sendJson(res, 503, { ok: false, error: error.message, hint: error.hint });
      return;
    }
    if (error.code === 'VALIDATION') {
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 422, {
      ok: false,
      error: error.message,
      message: error.message,
      details: error.details
    });
  }
};
