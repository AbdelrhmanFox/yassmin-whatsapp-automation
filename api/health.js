const { sheetsConfigured } = require('../dashboard/lib/google-sheets');
const {
  PAYMENT_SPREADSHEET_ID,
  PAYMENT_SHEET
} = require('../dashboard/lib/payments-store');
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
    sheetsConnected: sheetsConfigured(),
    botSpreadsheetId: process.env.BOT_SPREADSHEET_ID || '1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY',
    paymentSpreadsheetId: PAYMENT_SPREADSHEET_ID,
    paymentSheetName: PAYMENT_SHEET,
    authDisabled: DISABLE_AUTH,
    now: new Date().toISOString()
  });
};
