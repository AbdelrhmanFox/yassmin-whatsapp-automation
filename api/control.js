const { pushHistoryItem } = require('./lib/action-history');
const { sendJson, requireAuth } = require('./_helpers');

const CONTROL_WEBHOOK_URL = process.env.CONTROL_WEBHOOK_URL || '';

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

  if (!CONTROL_WEBHOOK_URL) {
    sendJson(res, 400, { ok: false, error: 'missing_CONTROL_WEBHOOK_URL' });
    return;
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const startedAt = Date.now();
    const response = await fetch(CONTROL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let upstream;
    const text = await response.text();
    try {
      upstream = text ? JSON.parse(text) : {};
    } catch {
      upstream = { raw: text };
    }

    const historyItem = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      action: payload.action || 'unknown',
      payload,
      status: response.status,
      ok: response.ok,
      latencyMs: Date.now() - startedAt,
      upstream
    };
    pushHistoryItem(historyItem);
    sendJson(res, response.status, { ok: response.ok, historyItem, upstream });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'control_request_failed' });
  }
};
