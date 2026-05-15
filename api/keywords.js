const {
  listKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword
} = require('../dashboard/lib/keywords-store');
const { sendJson, requireAuth } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const data = await listKeywords();
      sendJson(res, 200, data);
      return;
    }

    const body =
      typeof req.body === 'string' && req.body ? JSON.parse(req.body || '{}') : req.body || {};

    if (req.method === 'POST') {
      const data = await createKeyword(body);
      sendJson(res, 201, data);
      return;
    }

    const id = req.query.id || body.id;
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'missing_keyword_id' });
      return;
    }

    if (req.method === 'PATCH') {
      const data = await updateKeyword(id, body);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'DELETE') {
      const data = await deleteKeyword(id);
      sendJson(res, 200, data);
      return;
    }

    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    if (error.code === 'CONFIG') {
      sendJson(res, 503, { ok: false, error: error.message });
      return;
    }
    if (error.code === 'VALIDATION') {
      sendJson(res, 422, { ok: false, error: error.message });
      return;
    }
    if (error.code === 'NOT_FOUND') {
      sendJson(res, 404, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 500, { ok: false, error: error.message });
  }
};
