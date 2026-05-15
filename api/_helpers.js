const ADMIN_TOKEN = process.env.DASHBOARD_ADMIN_TOKEN || '';
const DISABLE_AUTH = String(process.env.DASHBOARD_DISABLE_AUTH ?? 'true').toLowerCase() === 'true';

function sendJson(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

function isAuthorized(req) {
  if (DISABLE_AUTH) return true;
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  return Boolean(ADMIN_TOKEN && token && token === ADMIN_TOKEN);
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  sendJson(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

module.exports = { sendJson, isAuthorized, requireAuth, DISABLE_AUTH, ADMIN_TOKEN: Boolean(ADMIN_TOKEN) };
