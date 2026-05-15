const { listThreadMessages } = require('../dashboard/lib/messages-store');
const { sendJson, requireAuth } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  const phone = String(req.query.phone || req.query.p || '').trim();
  if (!phone) {
    sendJson(res, 400, { ok: false, error: 'missing_phone' });
    return;
  }

  try {
    const data = await listThreadMessages(decodeURIComponent(phone));
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
