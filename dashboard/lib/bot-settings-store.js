const { getSupabase, DASHBOARD_FUNCTION_URL, useKeywordsEdge } = require('./supabase');

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const DEFAULTS = {
  id: 'default',
  user_cooldown_seconds: 40,
  duplicate_window_seconds: 120,
  user_burst_per_minute: 2,
  global_per_minute_limit: 45,
  daily_message_limit: 300,
  message_max_age_seconds: 300,
  human_handoff_hours: 24,
  log_dedup_blocked: true
};

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeSettings(row) {
  const s = { ...DEFAULTS, ...(row || {}) };
  return {
    id: 'default',
    user_cooldown_seconds: clampInt(s.user_cooldown_seconds, 0, 600, DEFAULTS.user_cooldown_seconds),
    duplicate_window_seconds: clampInt(
      s.duplicate_window_seconds,
      0,
      3600,
      DEFAULTS.duplicate_window_seconds
    ),
    user_burst_per_minute: clampInt(s.user_burst_per_minute, 1, 30, DEFAULTS.user_burst_per_minute),
    global_per_minute_limit: clampInt(
      s.global_per_minute_limit,
      1,
      200,
      DEFAULTS.global_per_minute_limit
    ),
    daily_message_limit: clampInt(s.daily_message_limit, 10, 5000, DEFAULTS.daily_message_limit),
    message_max_age_seconds: clampInt(
      s.message_max_age_seconds,
      30,
      86400,
      DEFAULTS.message_max_age_seconds
    ),
    human_handoff_hours: clampInt(s.human_handoff_hours, 1, 168, DEFAULTS.human_handoff_hours),
    log_dedup_blocked: s.log_dedup_blocked !== false,
    updated_at: s.updated_at || new Date().toISOString()
  };
}

async function edgeFetch(path, options = {}) {
  const base = (DASHBOARD_FUNCTION_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('missing_SUPABASE_DASHBOARD_FUNCTION_URL');
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'x-admin-token': process.env.DASHBOARD_ADMIN_TOKEN || '',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `edge_${res.status}`);
  return data;
}

async function getBotSettings() {
  if (useKeywordsEdge()) {
    const data = await edgeFetch('/bot-settings');
    return { ok: true, settings: normalizeSettings(data.settings) };
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('bot_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;
  if (!data) {
    const row = normalizeSettings(DEFAULTS);
    await supabase.from('bot_settings').upsert(row, { onConflict: 'id' });
    return { ok: true, settings: row };
  }
  return { ok: true, settings: normalizeSettings(data) };
}

async function updateBotSettings(patch) {
  const current = (await getBotSettings()).settings;
  const next = normalizeSettings({ ...current, ...patch, id: 'default', updated_at: new Date().toISOString() });

  if (useKeywordsEdge()) {
    return edgeFetch('/bot-settings', { method: 'PATCH', body: JSON.stringify(next) });
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('bot_settings')
    .upsert(next, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return { ok: true, settings: normalizeSettings(data) };
}

module.exports = { getBotSettings, updateBotSettings, DEFAULTS, normalizeSettings };
