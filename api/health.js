const { supabaseConfigured, usePaymentsEdge, PAYMENTS_FUNCTION_URL } = require('../dashboard/lib/supabase');
const { getProvider } = require('../dashboard/lib/payments-store');
const { sendJson, DISABLE_AUTH } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    status: 'running',
    platform: process.env.VERCEL ? 'vercel' : 'node',
    databaseProvider: getProvider(),
    supabaseConnected: supabaseConfigured(),
    supabaseEdgePayments: usePaymentsEdge(),
    supabasePaymentsFunctionUrl: PAYMENTS_FUNCTION_URL ? true : false,
    supabaseSchema: process.env.SUPABASE_SCHEMA || 'yassmin',
    authDisabled: DISABLE_AUTH,
    paymentSendMode: 'vercel-evolution',
    evolutionConfigured: Boolean(process.env.EVOLUTION_API_KEY),
    paymentSendWebhookConfigured: Boolean(process.env.N8N_PAYMENT_SEND_WEBHOOK_URL),
    now: new Date().toISOString()
  });
};
