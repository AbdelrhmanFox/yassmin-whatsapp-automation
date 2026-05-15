const { setRoutingMode } = require('../../dashboard/lib/messages-store');
const { sendJson } = require('../_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const phone = req.query.phone;
  if (!phone) {
    sendJson(res, 400, { ok: false, error: 'missing_phone' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const mode = body.mode === 'human' ? 'human' : 'auto';
    const data = await setRoutingMode(decodeURIComponent(phone), mode, {
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
};
