/**
 * Single Vercel function for /api/public/products and /api/public/payment
 * (Hobby plan limit: 12 serverless functions per deployment).
 */
const { listProducts, createPayment } = require('../../dashboard/lib/payments-store');
const { sendJson } = require('../_helpers');

const FALLBACK_PRODUCTS = [
  { product_code: 'inner_compass', label_ar: 'كتاب بوصلتك الداخلية', pdf_url: '' },
  { product_code: 'voltaren_social', label_ar: 'كتاب فولتارين السوشيال ميديا', pdf_url: '' }
];

const FORM_ENABLED = String(process.env.PUBLIC_FORM_ENABLED ?? 'true').toLowerCase() !== 'false';
const MAX_RECEIPT_B64 = 4 * 1024 * 1024;

function norm(s) {
  return String(s ?? '').trim();
}

function publicSegment(req) {
  const q = req.query && (req.query.path || req.query.pathParams);
  if (Array.isArray(q)) return norm(q[0]);
  if (q) return norm(q);
  try {
    const u = new URL(req.url || '', 'http://localhost');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'public' && parts[2]) return parts[2];
  } catch {
    /* ignore */
  }
  return '';
}

async function handleProducts(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    let products = await listProducts();
    if (!products.length) products = FALLBACK_PRODUCTS;
    sendJson(res, 200, { ok: true, products });
  } catch {
    sendJson(res, 200, { ok: true, products: FALLBACK_PRODUCTS, degraded: true });
  }
}

async function handlePayment(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!FORM_ENABLED) {
    sendJson(res, 503, { ok: false, error: 'form_disabled' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (norm(body.website)) {
      sendJson(res, 400, { ok: false, error: 'spam_rejected' });
      return;
    }

    if (body.receipt_base64 && body.receipt_base64.length > MAX_RECEIPT_B64) {
      sendJson(res, 413, { ok: false, error: 'receipt_too_large' });
      return;
    }

    const data = await createPayment(body);
    sendJson(res, 201, {
      ok: true,
      message:
        'تم استلام طلبك بنجاح. سيتم مراجعة الدفع وإرسال المنتج على واتساب بعد التأكيد.',
      form_timestamp: data.form_timestamp
    });
  } catch (error) {
    if (error.code === 'VALIDATION') {
      sendJson(res, 422, { ok: false, error: error.message, details: error.details });
      return;
    }
    if (error.code === 'DUPLICATE') {
      sendJson(res, 409, { ok: false, error: 'duplicate_submission' });
      return;
    }
    if (error.code === 'CONFIG') {
      sendJson(res, 503, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 500, {
      ok: false,
      error: error.message || 'submit_failed',
      hint:
        error.message === 'payment_insert_failed'
          ? 'تأكدي من نشر yassmin-dashboard-api على Supabase وتطبيق migration الإيصالات'
          : undefined
    });
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const seg = publicSegment(req).toLowerCase();
  if (seg === 'products') {
    await handleProducts(req, res);
    return;
  }
  if (seg === 'payment') {
    await handlePayment(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found', path: seg || 'missing' });
};
