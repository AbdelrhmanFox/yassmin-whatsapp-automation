const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SCHEMA = process.env.SUPABASE_SCHEMA || 'yassmin';

let client;

function stripTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

const PAYMENTS_FUNCTION_URL = process.env.SUPABASE_PAYMENTS_FUNCTION_URL || '';

function resolveDashboardFunctionUrl() {
  const explicit = stripTrailingSlash(process.env.SUPABASE_DASHBOARD_FUNCTION_URL || '');
  if (explicit) return explicit;
  const pay = stripTrailingSlash(PAYMENTS_FUNCTION_URL);
  if (pay && /yassmin-payments-api/i.test(pay)) {
    return stripTrailingSlash(
      pay.replace(/yassmin-payments-api(\/?)$/i, 'yassmin-dashboard-api$1')
    );
  }
  if (pay && /\/functions\/v1$/i.test(pay)) {
    return `${pay}/yassmin-dashboard-api`;
  }
  const base = stripTrailingSlash(process.env.SUPABASE_URL || '');
  if (base) return `${base}/functions/v1/yassmin-dashboard-api`;
  return pay;
}

const DASHBOARD_FUNCTION_URL = resolveDashboardFunctionUrl();

/** عند true: استخدمي PostgREST من Vercel بـ SUPABASE_SERVICE_ROLE_KEY حتى لو Edge معرّف (حالات نادرة). */
const PAYMENTS_USE_DIRECT_DB =
  String(process.env.SUPABASE_PAYMENTS_USE_DIRECT_DB || '').toLowerCase() === 'true';

function supabaseConfigured() {
  const anon = process.env.SUPABASE_ANON_KEY;
  return Boolean(
    SUPABASE_URL &&
      (SUPABASE_SERVICE_ROLE_KEY ||
        (anon && PAYMENTS_FUNCTION_URL) ||
        (anon && DASHBOARD_FUNCTION_URL))
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
  return supabaseConfigured();
}

function usePaymentsEdge() {
  if (PAYMENTS_USE_DIRECT_DB) return false;
  // جدول yassmin.payments عليه RLS بلا سياسات لـ anon → أي JWT بدور anon يعيد 0 صفوف.
  // لو وُضع مفتاح anon بالخطأ في SUPABASE_SERVICE_ROLE_KEY على Vercel، كان الكود يستخدم المسار المباشر ويعرض لائحة فارغة.
  // Edge يعمل بـ service_role الحقيقي داخل Supabase ويقرأ كل الصفوف.
  return Boolean(PAYMENTS_FUNCTION_URL && process.env.SUPABASE_ANON_KEY);
}

/** ردود البوت: نفس منطق RLS على yassmin.keywords — القراءة عبر yassmin-dashboard-api */
function useKeywordsEdge() {
  if (PAYMENTS_USE_DIRECT_DB) return false;
  return Boolean(DASHBOARD_FUNCTION_URL && process.env.SUPABASE_ANON_KEY);
}

function hasServiceRole() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = {
  getSupabase,
  supabaseConfigured,
  useSupabase,
  usePaymentsEdge,
  useKeywordsEdge,
  PAYMENTS_FUNCTION_URL,
  DASHBOARD_FUNCTION_URL,
  hasServiceRole,
  SCHEMA
};
