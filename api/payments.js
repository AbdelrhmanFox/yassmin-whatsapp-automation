const { listPayments } = require('../dashboard/lib/payments-store');
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
    const q = req.query.q || '';
    const status = req.query.status || 'all';
    const data = await listPayments({ q, status });
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
      hint:
        'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (preferred) or GOOGLE_SERVICE_ACCOUNT_JSON for Sheets fallback.'
    });
  }
};
