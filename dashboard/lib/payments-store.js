const { useSupabase, supabaseConfigured } = require('./supabase');
const sheetsStore = require('./payments-store-sheets');
const supabaseStore = require('./payments-store-supabase');

function activeStore() {
  return useSupabase() ? supabaseStore : sheetsStore;
}

function getProvider() {
  return useSupabase() ? 'supabase' : 'sheets';
}

async function listPayments(filters) {
  return activeStore().listPayments(filters);
}

async function updatePaymentDone(timestamp, done, options) {
  return activeStore().updatePaymentDone(timestamp, done, options);
}

async function createPayment(body) {
  if (!useSupabase()) {
    const err = new Error('supabase_required_for_public_form');
    err.code = 'CONFIG';
    throw err;
  }
  return supabaseStore.createPayment(body);
}

async function listProducts() {
  if (!useSupabase()) return [];
  return supabaseStore.listProducts();
}

module.exports = {
  listPayments,
  updatePaymentDone,
  createPayment,
  listProducts,
  readPaymentSheet: () =>
    useSupabase() ? supabaseStore.readPayments() : sheetsStore.readPaymentSheet(),
  summarize: (rows) =>
    useSupabase() ? supabaseStore.summarize(rows) : sheetsStore.summarize(rows),
  getProvider,
  supabaseConfigured,
  PAYMENT_SPREADSHEET_ID: sheetsStore.PAYMENT_SPREADSHEET_ID,
  PAYMENT_SHEET: sheetsStore.PAYMENT_SHEET,
  MATCH_COL: process.env.PAYMENT_MATCH_COLUMN || 'طابع زمني'
};
