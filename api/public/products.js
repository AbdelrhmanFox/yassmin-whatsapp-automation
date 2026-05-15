const { listProducts } = require('../../dashboard/lib/payments-store');
const { sendJson } = require('../_helpers');

const FALLBACK_PRODUCTS = [
  { product_code: 'inner_compass', label_ar: 'كتاب بوصلتك الداخلية', pdf_url: '' },
  { product_code: 'voltaren_social', label_ar: 'كتاب فولتارين السوشيال ميديا', pdf_url: '' }
];

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
    let products = await listProducts();
    if (!products.length) products = FALLBACK_PRODUCTS;
    sendJson(res, 200, { ok: true, products });
  } catch (error) {
    sendJson(res, 200, { ok: true, products: FALLBACK_PRODUCTS, degraded: true });
  }
};
