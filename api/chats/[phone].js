/**
 * PATCH /api/chats/:phone — تحويل لرد بشري / تفعيل الرد التلقائي.
 * مسار صريح على Vercel (أوثق من catch-all عند بعض الطلبات).
 */
const { handleApiRequest } = require('../../dashboard/lib/api-router');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (!req.query) req.query = {};
  const phone = String(req.query.phone || '').trim();
  req.query.path = ['chats', phone];
  return handleApiRequest(req, res);
};
