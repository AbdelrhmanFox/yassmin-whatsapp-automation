/**
 * Google Sheets Setup Script — WhatsApp Bot
 *
 * Run this once to populate the spreadsheet with the correct structure.
 *
 * HOW TO RUN:
 *   1. Install Node.js if not installed (https://nodejs.org)
 *   2. Open a terminal in this folder
 *   3. Run:  npm install googleapis
 *   4. Run:  node setup-google-sheets.js
 *
 * CREDENTIALS: copy .env.example → .env and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   Spreadsheet:   https://docs.google.com/spreadsheets/d/1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY
 */

const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('./scripts/load-env');
const { google } = require('googleapis');

loadEnvFile();
const http = require('http');
const url = require('url');
const open = require('open').default || require('open');

const SPREADSHEET_ID = '1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY';

/** عمليات الدفع (Google Form responses) — same ID as payment cron in n8n */
const PAYMENT_SPREADSHEET_ID = '1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

const TOKEN_SAVE_PATH = path.join(__dirname, 'google-tokens.json');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Copy .env.example to .env and fill values.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const KEYWORDS_HEADERS = [['keyword', 'reply', 'active']];

const KEYWORDS_DATA = [
  [
    'hello, hi, مرحبا, أهلاً, أهلا, هاي, السلام',
    '👋 Hello! How can we help you today? Reply with *price*, *location*, or *hours*.',
    'TRUE'
  ],
  [
    'price, prices, سعر, الأسعار, بكام, كام',
    '💰 Our pricing:\n- Service A: $50\n- Service B: $80\nReply to book!',
    'TRUE'
  ],
  [
    'location, address, عنوان, فين, وين',
    '📍 Address: 123 Main St\nGoogle Maps: https://maps.app.goo.gl/YOURLINK',
    'TRUE'
  ],
  [
    'hours, working hours, مواعيد, ساعات, امتى',
    '🕐 Working hours: Sat–Thu, 9am–6pm. Fri: closed.',
    'TRUE'
  ],
  [
    'human, agent, موظف, كلمني, واحد',
    '👤 Got it! A team member will reach out shortly. Please hold. 🙏',
    'TRUE'
  ],
  [
    'default',
    '😊 Sorry, didn\'t catch that! Reply with:\n*price* 💰 *location* 📍 *hours* 🕐',
    'TRUE'
  ]
];

const MESSAGE_LOG_HEADERS = [['timestamp', 'phone', 'message', 'keyword_matched', 'reply_sent', 'status', 'message_id']];

const PAUSED_CHATS_HEADERS = [['phone', 'paused_at', 'last_human_at', 'expires_at', 'reason', 'active']];

const BOT_OUTBOUND_HEADERS = [['message_id', 'phone', 'source', 'sent_at']];

const EMAIL_LEADS_HEADERS = [['created_at', 'last_seen_at', 'email', 'phone', 'name_hint', 'intent_type', 'latest_message', 'message_id', 'source', 'status']];

const PRODUCT_PDF_MAP_HEADERS = [['product_code', 'pdf_url', 'label_ar']];
const PRODUCT_PDF_MAP_SEED = [
  ['voltaren_social', 'https://drive.google.com/file/d/REPLACE_VOLTAREN/view?usp=sharing', 'فولتارين السوشيال ميديا'],
  ['inner_compass', 'https://drive.google.com/file/d/REPLACE_COMPASS/view?usp=sharing', 'بوصلتك الداخلية']
];

async function authorize() {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    });

    console.log('\n==============================================');
    console.log('Opening browser for Google authorization...');
    console.log('If browser does not open, visit this URL:');
    console.log(authUrl);
    console.log('==============================================\n');

    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;
        res.end('<h2>Authorization successful! You can close this tab.</h2>');
        server.close();

        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          try {
            fs.writeFileSync(TOKEN_SAVE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
            console.log('Saved OAuth tokens to google-tokens.json (for npm run sync:google-sheets)');
          } catch (_) {}
          resolve(oauth2Client);
        } catch (err) {
          reject(err);
        }
      }
    });

    server.listen(3000, () => {
      try { require('open')(authUrl); } catch (e) {
        // Browser may not open automatically — user sees URL above
      }
    });
  });
}

async function ensureSheetExists(sheets, spreadsheetId, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map(s => s.properties.title);

  if (!existing.includes(sheetTitle)) {
    console.log(`Creating sheet tab: ${sheetTitle}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: sheetTitle }
          }
        }]
      }
    });
  } else {
    console.log(`Sheet "${sheetTitle}" already exists.`);
  }
}

async function setupSpreadsheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('\n--- Setting up "keywords" sheet ---');
  await ensureSheetExists(sheets, SPREADSHEET_ID, 'keywords');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'keywords!A1:C1',
    valueInputOption: 'RAW',
    requestBody: { values: KEYWORDS_HEADERS }
  });
  console.log('  headers written: keyword | reply | active');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `keywords!A2:C${KEYWORDS_DATA.length + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: KEYWORDS_DATA }
  });
  console.log(`  ${KEYWORDS_DATA.length} keyword rows written`);

  console.log('\n--- Setting up "message_log" sheet ---');
  await ensureSheetExists(sheets, SPREADSHEET_ID, 'message_log');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'message_log!A1:G1',
    valueInputOption: 'RAW',
    requestBody: { values: MESSAGE_LOG_HEADERS }
  });
  console.log('  headers written: timestamp | phone | message | keyword_matched | reply_sent | status | message_id');

  console.log('\n--- Setting up "email_leads" sheet ---');
  await ensureSheetExists(sheets, SPREADSHEET_ID, 'email_leads');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'email_leads!A1:J1',
    valueInputOption: 'RAW',
    requestBody: { values: EMAIL_LEADS_HEADERS }
  });
  console.log('  headers written: created_at | last_seen_at | email | phone | name_hint | intent_type | latest_message | message_id | source | status');

  console.log('\n--- Setting up "paused_chats" sheet ---');
  await ensureSheetExists(sheets, SPREADSHEET_ID, 'paused_chats');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'paused_chats!A1:F1',
    valueInputOption: 'RAW',
    requestBody: { values: PAUSED_CHATS_HEADERS }
  });
  console.log('  headers written: phone | paused_at | last_human_at | expires_at | reason | active');

  console.log('\n--- Setting up "bot_outbound" sheet ---');
  await ensureSheetExists(sheets, SPREADSHEET_ID, 'bot_outbound');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'bot_outbound!A1:D1',
    valueInputOption: 'RAW',
    requestBody: { values: BOT_OUTBOUND_HEADERS }
  });
  console.log('  headers written: message_id | phone | source | sent_at');

  console.log('\n--- Payment spreadsheet (عمليات الدفع) ---');
  console.log('  Tab "عمليات الدفع": add Google Form question titled exactly **product_code** (dropdown values = codes in product_pdf_map).');
  console.log('  Also: Done | whatsapp_status | whatsapp_last_error | whatsapp_sent_at');
  console.log('  Spreadsheet: https://docs.google.com/spreadsheets/d/' + PAYMENT_SPREADSHEET_ID);

  console.log('\n--- Payment spreadsheet: tab product_pdf_map ---');
  await ensureSheetExists(sheets, PAYMENT_SPREADSHEET_ID, 'product_pdf_map');
  await sheets.spreadsheets.values.update({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: 'product_pdf_map!A1:C1',
    valueInputOption: 'RAW',
    requestBody: { values: PRODUCT_PDF_MAP_HEADERS }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: `product_pdf_map!A2:C${1 + PRODUCT_PDF_MAP_SEED.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: PRODUCT_PDF_MAP_SEED }
  });
  console.log('  Headers: product_code | pdf_url | label_ar');
  console.log(`  ${PRODUCT_PDF_MAP_SEED.length} example rows (replace pdf_url with real Drive links).`);

  console.log('\n✅ Google Sheets setup complete!');
  console.log('   Main spreadsheet: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID);
  console.log('   Payment spreadsheet: https://docs.google.com/spreadsheets/d/' + PAYMENT_SPREADSHEET_ID);
}

(async () => {
  try {
    console.log('WhatsApp Bot — Google Sheets Setup');
    console.log('====================================');
    const auth = await authorize();
    await setupSpreadsheet(auth);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('Cannot find module')) {
      console.error('\nMake sure to run:  npm install googleapis open');
    }
    process.exit(1);
  }
})();
