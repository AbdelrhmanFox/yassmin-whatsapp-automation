const { getSupabase, usePaymentsEdge, PAYMENTS_FUNCTION_URL, DASHBOARD_FUNCTION_URL, SCHEMA } =
  require('./supabase');
const { buildPaymentPayload, applyReceiptUrl } = require('./create-payment');
const { uploadReceipt } = require('./receipt-storage');

async function edgeFetch(path, options = {}) {
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const admin = options.adminToken || process.env.DASHBOARD_ADMIN_TOKEN || '';
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Content-Type': 'application/json',
    'x-admin-token': admin,
    ...(options.headers || {})
  };
  const url = `${PAYMENTS_FUNCTION_URL.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `edge_${res.status}`);
    if (res.status === 404) err.code = 'NOT_FOUND';
    throw err;
  }
  return data;
}

const MATCH_COL = process.env.PAYMENT_MATCH_COLUMN || 'طابع زمني';

function norm(s) {
  return String(s ?? '').trim();
}

function deriveStatus(row) {
  const done = Boolean(row.done);
  const wa = norm(row.whatsapp_status).toLowerCase();
  const dead = Boolean(row.dead_letter) || wa === 'dead_letter';

  if (dead) return 'dead_letter';
  if (wa === 'sent') return 'sent';
  if (wa === 'failed') return 'failed';
  if (done && !wa) return 'awaiting_whatsapp';
  if (done) return 'confirmed';
  return 'pending_review';
}

function mapRow(row) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const mapped = {
    id: norm(row.form_timestamp),
    rowNumber: null,
    timestamp: norm(row.form_timestamp),
    name: norm(row.name),
    email: norm(row.email),
    phone: norm(row.phone),
    product_code: norm(row.product_code),
    product_label: norm(row.product_label),
    payment_method: norm(row.payment_method),
    done: Boolean(row.done),
    done_raw: row.done ? 'TRUE' : '',
    whatsapp_status: norm(row.whatsapp_status),
    whatsapp_last_error: norm(row.whatsapp_last_error),
    whatsapp_sent_at: row.whatsapp_sent_at ? String(row.whatsapp_sent_at) : '',
    retry_count: String(row.retry_count ?? ''),
    dead_letter: Boolean(row.dead_letter),
    receipt_url:
      norm(row.receipt_url) ||
      norm(raw['رفع صوره الايصال']) ||
      norm(raw['رفع صوره الايصال ']) ||
      '',
    status: '',
    raw: { ...raw, [MATCH_COL]: row.form_timestamp, done: row.done }
  };
  mapped.status = deriveStatus(mapped);
  return mapped;
}

function summarize(rows) {
  const stats = {
    total: rows.length,
    pending_review: 0,
    awaiting_whatsapp: 0,
    sent: 0,
    failed: 0,
    dead_letter: 0,
    confirmed_other: 0
  };
  for (const row of rows) {
    if (row.status === 'pending_review') stats.pending_review += 1;
    else if (row.status === 'awaiting_whatsapp') stats.awaiting_whatsapp += 1;
    else if (row.status === 'sent') stats.sent += 1;
    else if (row.status === 'failed') stats.failed += 1;
    else if (row.status === 'dead_letter') stats.dead_letter += 1;
    else stats.confirmed_other += 1;
  }
  return stats;
}

function filterRows(rows, { q = '', status = 'all' }) {
  const query = norm(q).toLowerCase();
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    if (!query) return true;
    const hay = [
      row.timestamp,
      row.name,
      row.email,
      row.phone,
      row.product_code,
      row.product_label,
      row.whatsapp_status,
      row.whatsapp_last_error
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(query);
  });
}

async function readPayments() {
  if (usePaymentsEdge()) {
    const data = await edgeFetch('');
    return { rows: data.rows || [], schema: SCHEMA };
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []).map(mapRow).filter((r) => r.id);
  return { rows, schema: SCHEMA };
}

async function listPayments(filters = {}) {
  if (usePaymentsEdge()) {
    const q = encodeURIComponent(filters.q || '');
    const status = encodeURIComponent(filters.status || 'all');
    return edgeFetch(`?q=${q}&status=${status}`);
  }
  const { rows } = await readPayments();
  const filtered = filterRows(rows, filters);
  return {
    ok: true,
    provider: 'supabase',
    schema: SCHEMA,
    stats: summarize(rows),
    count: filtered.length,
    rows: filtered
  };
}

async function updatePaymentDone(formTimestamp, done, options = {}) {
  if (usePaymentsEdge()) {
    const id = encodeURIComponent(norm(formTimestamp));
    return edgeFetch(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done, resetWhatsapp: options.resetWhatsapp !== false })
    });
  }
  const supabase = getSupabase();
  const key = norm(formTimestamp);
  const patch = { done: Boolean(done) };

  if (!done && options.resetWhatsapp !== false) {
    patch.whatsapp_status = null;
    patch.whatsapp_last_error = null;
    patch.whatsapp_sent_at = null;
  }

  const { data, error } = await supabase
    .from('payments')
    .update(patch)
    .eq('form_timestamp', key)
    .select('form_timestamp')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error('payment_row_not_found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  return listPayments();
}

async function publicEdgeFetch(path, options = {}) {
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const bases = [PAYMENTS_FUNCTION_URL, DASHBOARD_FUNCTION_URL]
    .filter(Boolean)
    .map((b) => b.replace(/\/$/, ''));
  const unique = [...new Set(bases)];
  let lastError = 'payment_edge_unavailable';

  for (const base of unique) {
    const url = `${base}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    const msg = String(data.error || data.message || '');
    if (res.status === 404 || /not found/i.test(msg)) {
      lastError = msg || 'function_not_found';
      continue;
    }
    if (!res.ok) {
      const err = new Error(msg || `edge_${res.status}`);
      err.code = 'INSERT';
      throw err;
    }
    return data;
  }

  const err = new Error(lastError);
  err.code = 'EDGE_MISSING';
  throw err;
}

async function listProducts() {
  if (usePaymentsEdge()) {
    const anon = process.env.SUPABASE_ANON_KEY || '';
    const url = `${(PAYMENTS_FUNCTION_URL || DASHBOARD_FUNCTION_URL).replace(/\/$/, '')}/products`;
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'products_fetch_failed');
    return data.products || [];
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('product_pdf_map')
    .select('product_code, label_ar, pdf_url')
    .order('label_ar');
  if (error) throw error;
  return data || [];
}

function slimPayloadForEdge(payload) {
  const raw = { ...payload.raw };
  delete raw.receipt_base64;
  return {
    form_timestamp: payload.form_timestamp,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    product_code: payload.product_code,
    product_label: payload.product_label,
    payment_method: payload.payment_method,
    receipt_url: payload.receipt_url,
    receipt_base64: payload.receipt_base64,
    receipt_mime: payload.receipt_mime,
    raw
  };
}

async function createPayment(body) {
  let payload = buildPaymentPayload(body);

  if (usePaymentsEdge()) {
    const data = await publicEdgeFetch('/ingest/payment', {
      method: 'POST',
      body: JSON.stringify(slimPayloadForEdge(payload))
    });
    return { ok: true, form_timestamp: payload.form_timestamp, ...data };
  }

  const supabase = getSupabase();
  if (payload.receipt_base64 && !payload.receipt_url) {
    const receiptUrl = await uploadReceipt(supabase, {
      phone: payload.phone,
      base64: payload.receipt_base64,
      mime: payload.receipt_mime
    });
    payload = applyReceiptUrl(payload, receiptUrl);
  }

  const row = {
    form_timestamp: payload.form_timestamp,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    product_code: payload.product_code,
    product_label: payload.product_label,
    payment_method: payload.payment_method,
    receipt_url: payload.receipt_url,
    done: false,
    raw: payload.raw
  };

  const { error } = await supabase.from('payments').insert(row);
  if (error) {
    if (error.code === '23505') {
      const err = new Error('duplicate_submission');
      err.code = 'DUPLICATE';
      throw err;
    }
    throw error;
  }

  return { ok: true, form_timestamp: payload.form_timestamp };
}

module.exports = {
  listPayments,
  updatePaymentDone,
  createPayment,
  listProducts,
  readPayments,
  summarize,
  MATCH_COL
};
