const { getSupabase, DASHBOARD_FUNCTION_URL, useKeywordsEdge } = require('./supabase');

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

async function edgeFetch(path, options = {}) {
  const base = (DASHBOARD_FUNCTION_URL || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('missing_SUPABASE_DASHBOARD_FUNCTION_URL');
  }
  const anon = SUPABASE_ANON_KEY;
  const admin = process.env.DASHBOARD_ADMIN_TOKEN || '';
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Content-Type': 'application/json',
    'x-admin-token': admin,
    ...(options.headers || {})
  };
  const url = `${base}${path}`;
  const res = await fetch(url, { ...options, headers });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const snippet = raw.slice(0, 80).replace(/\s+/g, ' ');
    const err = new Error(
      snippet.startsWith('<') || /the page could not be found/i.test(raw)
        ? 'edge_html_response — انشري yassmin-dashboard-api على Supabase أو راجعي SUPABASE_DASHBOARD_FUNCTION_URL'
        : `edge_invalid_json: ${snippet}`
    );
    err.code = 'EDGE_PARSE';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || `edge_${res.status}`);
    if (res.status === 404) err.code = 'NOT_FOUND';
    throw err;
  }
  return data;
}

/** نفس منطق الدفعات/الكلمات: RLS على yassmin.* يمنع anon — القراءة عبر Edge بـ service_role داخل Supabase. */
function useMessagesEdge() {
  return useKeywordsEdge();
}

async function getDb() {
  if (useMessagesEdge()) return null;
  return getSupabase();
}

function normPhone(s) {
  let d = String(s ?? '').replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('0020') && d.length > 12) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

/** لا تُعرض في اللوحة: فلتر ويب هوك أو أرقام غير صالحة. */
function isNoiseLogRow(row) {
  const st = String(row?.status ?? '');
  if (st === 'inbound_filtered') return true;
  const phone = normPhone(row?.phone);
  if (!phone || phone === '209999999999') return true;
  if (!/^20\d{10}$/.test(phone)) return true;
  return false;
}

function isValidDashboardPhone(phone) {
  const p = normPhone(phone);
  return Boolean(p && p !== '209999999999' && /^20\d{10}$/.test(p));
}

function deriveThreadStatus(thread) {
  const until = thread.human_handoff_until ? new Date(thread.human_handoff_until).getTime() : 0;
  const humanActive =
    thread.routing_mode === 'human' && (!until || until > Date.now());
  if (humanActive) return 'human_handoff';
  if (thread.last_status === 'human_handoff_skipped' || thread.last_status === 'paused_skipped') {
    return 'human_handoff';
  }
  if (thread.last_reply_at || thread.last_status === 'replied' || thread.last_status === 'auto_replied') {
    return 'auto_replied';
  }
  return 'received';
}

function mapThread(row) {
  const status = deriveThreadStatus(row);
  return {
    phone: row.phone,
    last_message_at: row.last_message_at,
    last_inbound_text: row.last_inbound_text || '',
    last_inbound_at: row.last_inbound_at,
    last_reply_text: row.last_reply_text || '',
    last_reply_at: row.last_reply_at,
    last_keyword: row.last_keyword || '',
    routing_mode: row.routing_mode || 'auto',
    human_handoff_reason: row.human_handoff_reason || '',
    human_handoff_until: row.human_handoff_until,
    message_count: row.message_count || 0,
    status,
    status_label:
      status === 'human_handoff'
        ? 'تحويل لرد بشري'
        : status === 'auto_replied'
          ? 'رد تلقائي'
          : 'رسالة واردة'
  };
}

function buildThreadsFromMessageLog(logRows) {
  if (!logRows || !logRows.length) return [];
  const sorted = [...logRows].sort(
    (a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime()
  );
  const byPhone = new Map();
  for (const row of sorted) {
    if (isNoiseLogRow(row)) continue;
    const phone = normPhone(row.phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) {
      byPhone.set(phone, {
        phone,
        last_message_at: row.logged_at,
        last_inbound_text: '',
        last_inbound_at: null,
        last_reply_text: '',
        last_reply_at: null,
        last_keyword: '',
        routing_mode: 'auto',
        message_count: 0,
        last_status: null,
        human_handoff_until: null,
        human_handoff_reason: null
      });
    }
    const t = byPhone.get(phone);
    t.message_count += 1;
    t.last_message_at = row.logged_at;
    const msg = String(row.message ?? '').trim();
    const reply = String(row.reply_sent ?? '').trim();
    if (msg) {
      t.last_inbound_text = msg;
      t.last_inbound_at = row.logged_at;
    }
    if (reply) {
      t.last_reply_text = reply;
      t.last_reply_at = row.logged_at;
    }
    if (row.keyword_matched) t.last_keyword = row.keyword_matched;
    if (row.status) t.last_status = row.status;
    if (row.routing_mode) t.routing_mode = row.routing_mode;
  }
  return Array.from(byPhone.values()).sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

async function listThreads(filters = {}) {
  if (useMessagesEdge()) {
    const q = encodeURIComponent(filters.q || '');
    const status = encodeURIComponent(filters.status || 'all');
    return edgeFetch(`/messages?q=${q}&status=${status}`);
  }

  const supabase = await getDb();
  const { data: threads, error } = await supabase
    .from('chat_threads')
    .select('*')
    .order('last_message_at', { ascending: false });
  if (error) throw error;

  let rows = (threads || []).map(mapThread).filter((r) => isValidDashboardPhone(r.phone));
  if (!(threads || []).length) {
    const { data: logForThreads, error: logErr } = await supabase
      .from('message_log')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(500);
    if (logErr) throw logErr;
    const synthetic = buildThreadsFromMessageLog(logForThreads || []);
    if (synthetic.length) rows = synthetic.map(mapThread);
  }
  const q = String(filters.q || '')
    .trim()
    .toLowerCase();
  if (filters.status && filters.status !== 'all') {
    rows = rows.filter((r) => r.status === filters.status);
  }
  if (q) {
    rows = rows.filter((r) =>
      [r.phone, r.last_inbound_text, r.last_reply_text, r.last_keyword]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }

  const stats = {
    total: rows.length,
    auto_replied: rows.filter((r) => r.status === 'auto_replied').length,
    human_handoff: rows.filter((r) => r.status === 'human_handoff').length,
    received: rows.filter((r) => r.status === 'received').length
  };

  const { data: recentRaw } = await supabase
    .from('message_log')
    .select('*')
    .order('logged_at', { ascending: false })
    .limit(200);
  let hideDedup = false;
  try {
    const { getBotSettings } = require('./bot-settings-store');
    hideDedup = (await getBotSettings()).settings?.log_dedup_blocked === false;
  } catch {}
  const recent = (recentRaw || [])
    .filter((r) => !isNoiseLogRow(r))
    .filter((r) => !(hideDedup && r.status === 'dedup_blocked'))
    .slice(0, 120);

  return {
    ok: true,
    provider: 'supabase',
    stats,
    count: rows.length,
    threads: rows,
    recent_messages: recent
  };
}

async function setRoutingMode(phone, mode, options = {}) {
  const p = normPhone(phone);
  if (!p) {
    const err = new Error('invalid_phone');
    err.code = 'VALIDATION';
    throw err;
  }

  if (useMessagesEdge()) {
    await edgeFetch(`/chats/${encodeURIComponent(p)}/routing`, {
      method: 'PATCH',
      body: JSON.stringify({ mode, reason: options.reason || '' })
    });
    return listThreads();
  }

  const supabase = await getDb();
  const now = new Date();
  const expiresIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  if (mode === 'human') {
    await supabase.from('paused_chats').upsert(
      {
        phone: p,
        paused_at: now.toISOString(),
        last_human_at: now.toISOString(),
        expires_at: expiresIso,
        reason: options.reason || 'dashboard_manual',
        active: true
      },
      { onConflict: 'phone' }
    );
    await supabase
      .from('chat_threads')
      .upsert(
        {
          phone: p,
          routing_mode: 'human',
          human_handoff_reason: options.reason || 'dashboard_manual',
          human_handoff_until: expiresIso,
          last_status: 'human_handoff',
          updated_at: now.toISOString()
        },
        { onConflict: 'phone' }
      );
  } else {
    await supabase.from('paused_chats').update({ active: false }).eq('phone', p);
    await supabase
      .from('chat_threads')
      .upsert(
        {
          phone: p,
          routing_mode: 'auto',
          human_handoff_reason: null,
          human_handoff_until: null,
          last_status: 'auto_resumed',
          updated_at: now.toISOString()
        },
        { onConflict: 'phone' }
      );
  }

  return listThreads();
}

async function ingestMessage(payload) {
  const p = normPhone(payload.phone);
  if (!p) return { ok: false, error: 'invalid_phone' };

  const row = {
    phone: p,
    message: payload.message || null,
    keyword_matched: payload.keyword_matched || null,
    reply_sent: payload.reply_sent || null,
    status: payload.status || (payload.reply_sent ? 'auto_replied' : 'received'),
    message_id: payload.message_id || null,
    direction: payload.direction || 'inbound',
    routing_mode: payload.routing_mode || 'auto',
    logged_at: payload.timestamp || payload.logged_at || new Date().toISOString()
  };

  if (useMessagesEdge()) {
    return edgeFetch('/ingest/message', { method: 'POST', body: JSON.stringify(row) });
  }

  const supabase = await getDb();
  const { error } = await supabase.from('message_log').insert(row);
  if (error) throw error;

  if (payload.reply_sent) {
    await supabase.from('bot_outbound').upsert(
      {
        message_id: payload.message_id || `bot-${Date.now()}`,
        phone: p,
        source: 'bot',
        sent_at: new Date().toISOString()
      },
      { onConflict: 'message_id' }
    );
  }

  return { ok: true };
}

async function ingestPausedChat(payload) {
  const p = normPhone(payload.phone);
  if (!p) return { ok: false, error: 'invalid_phone' };

  const active = payload.active !== false;
  const now = new Date();
  const expires =
    payload.expires_at || new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  if (useMessagesEdge()) {
    return edgeFetch('/ingest/paused-chat', {
      method: 'POST',
      body: JSON.stringify({ ...payload, phone: p, active, expires_at: expires })
    });
  }

  const supabase = await getDb();
  if (active) {
    await supabase.from('paused_chats').upsert(
      {
        phone: p,
        paused_at: payload.paused_at || now.toISOString(),
        last_human_at: payload.last_human_at || now.toISOString(),
        expires_at: expires,
        reason: payload.reason || 'human_reply',
        active: true
      },
      { onConflict: 'phone' }
    );
    await supabase.from('chat_threads').upsert(
      {
        phone: p,
        routing_mode: 'human',
        human_handoff_reason: payload.reason || 'human_reply',
        human_handoff_until: expires,
        last_status: 'human_handoff',
        updated_at: now.toISOString()
      },
      { onConflict: 'phone' }
    );
  } else {
    await supabase.from('paused_chats').update({ active: false }).eq('phone', p);
  }

  return { ok: true };
}

async function listThreadMessages(phone) {
  const p = normPhone(phone);
  if (!p) {
    const err = new Error('invalid_phone');
    err.code = 'VALIDATION';
    throw err;
  }
  if (useMessagesEdge()) {
    return edgeFetch(`/messages/thread?phone=${encodeURIComponent(p)}`);
  }
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('message_log')
    .select('*')
    .eq('phone', p)
    .order('logged_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return { ok: true, phone: p, messages: data || [] };
}

async function listPausedChats() {
  if (useMessagesEdge()) {
    return edgeFetch('/paused-chats');
  }
  const supabase = await getDb();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('paused_chats')
    .select('phone, paused_at, last_human_at, expires_at, reason, active')
    .eq('active', true)
    .gt('expires_at', now)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return { ok: true, rows: data || [] };
}

module.exports = {
  listThreads,
  listPausedChats,
  setRoutingMode,
  ingestMessage,
  ingestPausedChat,
  listThreadMessages,
  normPhone
};
