const { updatePaymentDone } = require('../../dashboard/lib/payments-store');
const { sendJson, requireAuth } = require('../_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  const id = req.query.id || req.query.timestamp;
  if (!id) {
    sendJson(res, 400, { ok: false, error: 'missing_payment_id' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const done = Boolean(body.done);
    const resetWhatsapp = body.resetWhatsapp !== false;
    const data = await updatePaymentDone(decodeURIComponent(id), done, { resetWhatsapp });
    sendJson(res, 200, {
      ok: true,
      message: done ? 'تم تفعيل تأكيد الدفع' : 'تم إلغاء التأكيد',
      stats: data.stats,
      rows: data.rows
    });
  } catch (error) {
    const code = error.code === 'NOT_FOUND' ? 404 : error.code === 'SCHEMA' ? 422 : 500;
    sendJson(res, code, { ok: false, error: error.message });
  }
};
