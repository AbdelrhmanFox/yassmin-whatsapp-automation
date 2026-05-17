/**
 * Catch-all API for Vercel Hobby (≤12 serverless functions per deployment).
 */
const { handleApiRequest } = require('../dashboard/lib/api-router');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  return handleApiRequest(req, res);
};
