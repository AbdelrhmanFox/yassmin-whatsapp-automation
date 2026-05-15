function norm(s) {
  return String(s ?? '').trim();
}

function normPhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('0020') && d.length > 12) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

/** نفس شكل Google Forms (طابع زمني) لتوافق n8n والداشبورد */
function formatFormTimestamp(d = new Date()) {
  return d.toLocaleString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildPaymentPayload(body) {
  const name = norm(body.name);
  const email = norm(body.email).toLowerCase();
  const phone = normPhone(body.phone || body.phone_whatsapp);
  const phoneAlt = norm(body.phone_alt);
  const product_code = norm(body.product_code);
  const product_label = norm(body.product_label || body.notes);
  const payment_method = norm(body.payment_method);
  const receipt_url = norm(body.receipt_url);
  const receipt_note = norm(body.receipt_note);

  const errors = [];
  if (!name) errors.push('name_required');
  if (!email || !isValidEmail(email)) errors.push('email_invalid');
  if (!phone || phone.length < 10) errors.push('phone_invalid');
  if (!product_code) errors.push('product_required');
  if (!payment_method) errors.push('payment_method_required');

  if (errors.length) {
    const err = new Error(errors.join(','));
    err.code = 'VALIDATION';
    err.details = errors;
    throw err;
  }

  const now = new Date();
  const form_timestamp = formatFormTimestamp(now);

  const raw = {
    'طابع زمني': form_timestamp,
    الاسم: name,
    'البريد الالكتروني': email,
    'طرق الدفع': payment_method,
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله': phone,
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله2': phoneAlt,
    'محتاج اي ': product_label,
    product_code,
    'رفع صوره الايصال': receipt_url || receipt_note || '',
    source: 'dashboard_form',
    submitted_at: now.toISOString()
  };

  if (body.receipt_base64) {
    const b64 = String(body.receipt_base64);
    if (b64.length > 900_000) {
      const err = new Error('receipt_too_large');
      err.code = 'VALIDATION';
      throw err;
    }
    raw.receipt_base64 = b64;
    raw.receipt_mime = norm(body.receipt_mime) || 'image/jpeg';
  }

  return {
    form_timestamp,
    name,
    email,
    phone,
    product_code,
    product_label,
    payment_method,
    done: false,
    whatsapp_status: null,
    whatsapp_last_error: null,
    whatsapp_sent_at: null,
    retry_count: 0,
    dead_letter: false,
    raw,
    receipt_base64: body.receipt_base64 || null,
    receipt_mime: body.receipt_mime || null
  };
}

module.exports = {
  norm,
  normPhone,
  formatFormTimestamp,
  buildPaymentPayload
};
