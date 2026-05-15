const { listThreads } = require('../dashboard/lib/messages-store');
const { sendJson } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const q = req.query.q || '';
    const status = req.query.status || 'all';
    const data = await listThreads({ q, status });
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
