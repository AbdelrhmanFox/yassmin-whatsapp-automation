const { getBotSettings, updateBotSettings } = require('../dashboard/lib/bot-settings-store');
const { sendJson, requireAuth } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      sendJson(res, 200, await getBotSettings());
      return;
    }

    const body =
      typeof req.body === 'string' && req.body ? JSON.parse(req.body || '{}') : req.body || {};

    if (req.method === 'PATCH') {
      sendJson(res, 200, await updateBotSettings(body));
      return;
    }

    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
