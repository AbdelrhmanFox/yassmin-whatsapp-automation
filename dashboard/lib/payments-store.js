const { supabaseConfigured } = require('./supabase');
const supabaseStore = require('./payments-store-supabase');

async function listPayments(filters) {
  return supabaseStore.listPayments(filters);
}

async function updatePaymentDone(timestamp, done, options) {
  return supabaseStore.updatePaymentDone(timestamp, done, options);
}

async function updatePaymentWhatsappStatus(timestamp, fields) {
  return supabaseStore.updatePaymentWhatsappStatus(timestamp, fields);
}

async function createPayment(body) {
  return supabaseStore.createPayment(body);
}

async function listProducts() {
  return supabaseStore.listProducts();
}

module.exports = {
  listPayments,
  updatePaymentDone,
  updatePaymentWhatsappStatus,
  createPayment,
  listProducts,
  readPaymentSheet: () => supabaseStore.readPayments(),
  summarize: (rows) => supabaseStore.summarize(rows),
  getProvider: () => 'supabase',
  supabaseConfigured,
  MATCH_COL: process.env.PAYMENT_MATCH_COLUMN || 'طابع زمني'
};
