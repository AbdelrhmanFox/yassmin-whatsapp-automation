const { ingestPausedChat } = require('../../../dashboard/lib/messages-store');
const { sendJson } = require('../../_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  if (secret) {
    const got = req.headers['x-n8n-secret'] || '';
    if (got !== secret) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const data = await ingestPausedChat(body);
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
