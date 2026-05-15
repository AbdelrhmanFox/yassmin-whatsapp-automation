const { listHistory } = require('../dashboard/lib/action-history');
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

  sendJson(res, 200, { ok: true, items: listHistory() });
};
