const { getSupabase, useSupabase, supabaseConfigured } = require('./supabase');

function ensureClient() {
  if (!useSupabase() || !supabaseConfigured()) {
    const e = new Error('Keywords تحتاج Supabase — عيّني DATABASE_PROVIDER=supabase والمفاتيح.');
    e.code = 'CONFIG';
    throw e;
  }
  try {
    return getSupabase();
  } catch {
    const e = new Error('أضيفي SUPABASE_SERVICE_ROLE_KEY على الخادم لتحرير الردود من اللوحة.');
    e.code = 'CONFIG';
    throw e;
  }
}

async function listKeywords() {
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
  const db = ensureClient();
  const keyword = String(body.keyword ?? '').trim();
  const reply = String(body.reply ?? '').trim();
  if (!keyword || !reply) {
    const e = new Error('الحقلان: كلمات التشغيل والرد مطلوبان');
    e.code = 'VALIDATION';
    throw e;
  }
  const row = {
    keyword,
    reply,
    active: body.active !== false,
    sort_order: Number(body.sort_order) || 0
  };
  const { data, error } = await db.from('keywords').insert(row).select('*').single();
  if (error) throw error;
  return { ok: true, keyword: data };
}

async function updateKeyword(id, body) {
  const db = ensureClient();
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
  const db = ensureClient();
  const idStr = String(id ?? '').trim();
  if (!idStr) {
    const e = new Error('معرّف غير صالح');
    e.code = 'VALIDATION';
    throw e;
  }
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
