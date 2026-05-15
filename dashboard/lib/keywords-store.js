const {
  getSupabase,
  useSupabase,
  supabaseConfigured,
  useKeywordsEdge,
  DASHBOARD_FUNCTION_URL
} = require('./supabase');

function ensureClient() {
  if (!useSupabase() || !supabaseConfigured()) {
    const e = new Error('Keywords تحتاج Supabase — عيّني SUPABASE_URL والمفاتيح (انظري .env.example).');
    e.code = 'CONFIG';
    throw e;
  }
  try {
    return getSupabase();
  } catch {
    const e = new Error(
      'أضيفي SUPABASE_SERVICE_ROLE_KEY على الخادم، أو عيّني SUPABASE_ANON_KEY + SUPABASE_DASHBOARD_FUNCTION_URL لاستخدام Edge.'
    );
    e.code = 'CONFIG';
    throw e;
  }
}

async function edgeFetch(path, options = {}) {
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const admin = process.env.DASHBOARD_ADMIN_TOKEN || '';
  const base = DASHBOARD_FUNCTION_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${base}${p}`, {
    ...options,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
      ...(admin ? { 'x-admin-token': admin } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = data.path ? ` (${data.path})` : '';
    const err = new Error((data.error || `edge_${res.status}`) + hint);
    if (res.status === 404) err.code = 'NOT_FOUND';
    if (res.status === 401) err.code = 'UNAUTHORIZED';
    if (res.status === 400 || res.status === 422) err.code = 'VALIDATION';
    throw err;
  }
  return data;
}

async function listKeywords() {
  if (useKeywordsEdge()) {
    const data = await edgeFetch('/keywords');
    return { ok: true, keywords: data.keywords || [] };
  }
  const db = ensureClient();
  const { data, error } = await db
    .from('keywords')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return { ok: true, keywords: data || [] };
}

async function createKeyword(body) {
  const rowIn = {
    keyword: String(body.keyword ?? '').trim(),
    reply: String(body.reply ?? '').trim(),
    active: body.active !== false,
    sort_order: Number(body.sort_order) || 0
  };
  if (!rowIn.keyword || !rowIn.reply) {
    const e = new Error('الحقلان: كلمات التشغيل والرد مطلوبان');
    e.code = 'VALIDATION';
    throw e;
  }

  if (useKeywordsEdge()) {
    return edgeFetch('/keywords', { method: 'POST', body: JSON.stringify(rowIn) });
  }

  const db = ensureClient();
  const row = rowIn;
  const { data, error } = await db.from('keywords').insert(row).select('*').single();
  if (error) throw error;
  return { ok: true, keyword: data };
}

async function updateKeyword(id, body) {
  const idStr = String(id ?? '').trim();
  if (!idStr) {
    const e = new Error('معرّف غير صالح');
    e.code = 'VALIDATION';
    throw e;
  }
  const patch = { updated_at: new Date().toISOString() };
  if (body.keyword !== undefined) patch.keyword = String(body.keyword ?? '').trim();
  if (body.reply !== undefined) patch.reply = String(body.reply ?? '').trim();
  if (body.active !== undefined) patch.active = body.active === true;
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
  if (Object.keys(patch).length <= 1) {
    const e = new Error('لا يوجد ما يُحدَّث');
    e.code = 'VALIDATION';
    throw e;
  }
  if (patch.keyword !== undefined && patch.keyword === '') {
    const e = new Error('الكلمات لا يمكن أن تكون فارغة');
    e.code = 'VALIDATION';
    throw e;
  }
  if (patch.reply !== undefined && patch.reply === '') {
    const e = new Error('الرد لا يمكن أن يكون فارغًا');
    e.code = 'VALIDATION';
    throw e;
  }

  if (useKeywordsEdge()) {
    const payload = {};
    if (body.keyword !== undefined) payload.keyword = patch.keyword;
    if (body.reply !== undefined) payload.reply = patch.reply;
    if (body.active !== undefined) payload.active = patch.active;
    if (body.sort_order !== undefined) payload.sort_order = patch.sort_order;
    return edgeFetch(`/keywords/${encodeURIComponent(idStr)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  const db = ensureClient();
  const { data, error } = await db.from('keywords').update(patch).eq('id', idStr).select('*').maybeSingle();
  if (error) throw error;
  if (!data) {
    const e = new Error('السجل غير موجود');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return { ok: true, keyword: data };
}

async function deleteKeyword(id) {
  const idStr = String(id ?? '').trim();
  if (!idStr) {
    const e = new Error('معرّف غير صالح');
    e.code = 'VALIDATION';
    throw e;
  }

  if (useKeywordsEdge()) {
    await edgeFetch(`/keywords/${encodeURIComponent(idStr)}`, { method: 'DELETE' });
    return { ok: true, deleted: idStr };
  }

  const db = ensureClient();
  const { data: deleted, error } = await db.from('keywords').delete().eq('id', idStr).select('id');
  if (error) throw error;
  if (!deleted?.length) {
    const e = new Error('السجل غير موجود');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return { ok: true, deleted: idStr };
}

module.exports = { listKeywords, createKeyword, updateKeyword, deleteKeyword };
