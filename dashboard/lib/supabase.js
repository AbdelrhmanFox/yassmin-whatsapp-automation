const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SCHEMA = process.env.SUPABASE_SCHEMA || 'yassmin';

let client;

const PAYMENTS_FUNCTION_URL = process.env.SUPABASE_PAYMENTS_FUNCTION_URL || '';
const DASHBOARD_FUNCTION_URL =
  process.env.SUPABASE_DASHBOARD_FUNCTION_URL ||
  PAYMENTS_FUNCTION_URL.replace(/yassmin-payments-api\/?$/, 'yassmin-dashboard-api');

/** عند true: استخدمي PostgREST من Vercel بـ SUPABASE_SERVICE_ROLE_KEY حتى لو Edge معرّف (حالات نادرة). */
const PAYMENTS_USE_DIRECT_DB =
  String(process.env.SUPABASE_PAYMENTS_USE_DIRECT_DB || '').toLowerCase() === 'true';

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
      (SUPABASE_SERVICE_ROLE_KEY || (PAYMENTS_FUNCTION_URL && process.env.SUPABASE_ANON_KEY))
  );
}

function getSupabase() {
  if (!supabaseConfigured()) {
    throw new Error('missing_SUPABASE_URL_or_SERVICE_ROLE_KEY');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: SCHEMA }
    });
  }
  return client;
}

function useSupabase() {
  const provider = (process.env.DATABASE_PROVIDER || '').toLowerCase();
  if (provider === 'sheets') return false;
  if (provider === 'supabase') return supabaseConfigured();
  return supabaseConfigured();
}

function usePaymentsEdge() {
  if (PAYMENTS_USE_DIRECT_DB) return false;
  // جدول yassmin.payments عليه RLS بلا سياسات لـ anon → أي JWT بدور anon يعيد 0 صفوف.
  // لو وُضع مفتاح anon بالخطأ في SUPABASE_SERVICE_ROLE_KEY على Vercel، كان الكود يستخدم المسار المباشر ويعرض لائحة فارغة.
  // Edge يعمل بـ service_role الحقيقي داخل Supabase ويقرأ كل الصفوف.
  return Boolean(PAYMENTS_FUNCTION_URL && process.env.SUPABASE_ANON_KEY);
}

function hasServiceRole() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = {
  getSupabase,
  supabaseConfigured,
  useSupabase,
  usePaymentsEdge,
  PAYMENTS_FUNCTION_URL,
  DASHBOARD_FUNCTION_URL,
  hasServiceRole,
  SCHEMA
};
