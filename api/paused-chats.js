const { listPausedChats } = require('../dashboard/lib/messages-store');
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

  try {
    const data = await listPausedChats();
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
