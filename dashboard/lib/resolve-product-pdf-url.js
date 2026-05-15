function normLabel(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match payment row to product_pdf_map: slug (inner_compass), Arabic in product_code, or product_label vs label_ar.
 */
function resolveProductPdfUrl(productCode, productLabel, products) {
  const entries = [];
  for (const p of products || []) {
    const c = String(p.product_code || '')
      .trim()
      .toLowerCase();
    const u = String(p.pdf_url || '').trim();
    const lbl = normLabel(p.label_ar).toLowerCase();
    if (!u || /REPLACE/i.test(u)) continue;
    entries.push({ code: c, url: u, label: lbl });
  }

  const pdfByCode = {};
  for (const e of entries) {
    if (e.code) pdfByCode[e.code] = e.url;
  }

  const code = String(productCode || '')
    .trim()
    .toLowerCase();
  const pl = normLabel(productLabel).toLowerCase();

  let pdfUrl = code ? pdfByCode[code] || '' : '';

  if (!pdfUrl && code) {
    const hit = entries.find((e) => e.label === code || e.code === code);
    if (hit) pdfUrl = hit.url;
  }

  if (!pdfUrl && pl) {
    const hit = entries.find(
      (e) => e.label && (pl === e.label || pl.includes(e.label) || e.label.includes(pl))
    );
    if (hit) pdfUrl = hit.url;
  }

  return pdfUrl;
}

module.exports = { resolveProductPdfUrl, normLabel };
