/**
 * يطبّق تعديلات مباشرة على الشيتين الحيّين:
 * - WhatsApp Bot Data (1fr...) : تبويب PDF → هيكل product_code | label_ar | pdf_url | ملاحظة
 * - عمليات الدفع (1Do...)    : تبويب product_pdf_map (إن لم يكن موجودًا يُنشأ)
 * - اختياري: صف عنوان message_log يضمن عمود message_id
 *
 * تشغيل من مجلد المشروع:
 *   npm install googleapis open
 *   npm run sync:google-sheets
 *
 * أول مرة: يفتح المتصفح للموافقة على Google، ثم يُحفظ التوكن في google-tokens.json (لا ترفعه لـ Git).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { loadEnvFile } = require('./load-env');
const { google } = require('googleapis');

loadEnvFile();

const ROOT = path.join(__dirname, '..');
const TOKEN_PATH = path.join(ROOT, 'google-tokens.json');

const SPREADSHEET_ID = '1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY';
const PAYMENT_SPREADSHEET_ID = '1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Copy .env.example to .env and fill values.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

/** تبويب PDF في ملف البوت — gid≈1548678091 */
const BOT_PDF_SHEET = 'PDF';
const PDF_TABLE = [
  ['product_code', 'label_ar', 'pdf_url', 'ملاحظة'],
  [
    'inner_compass',
    'كتاب بوصلتك الداخلية',
    'https://drive.google.com/file/d/REPLACE_INNER_COMPASS_PDF/view?usp=sharing',
    'استبدلي REPLACE_INNER_COMPASS_PDF بمعرّف ملف PDF الكتاب (مشاركة: أي شخص لديه الرابط)',
  ],
  [
    'voltaren_social',
    'كتاب فولتارين السوشيال ميديا',
    'https://drive.google.com/file/d/REPLACE_VOLTAREN_PDF/view?usp=sharing',
    'نفس ملف الدفع → product_pdf_map يجب أن يطابق الأكواد',
  ],
];

const PRODUCT_PDF_MAP_HEADERS = [['product_code', 'pdf_url', 'label_ar']];
const PRODUCT_PDF_MAP_ROWS = [
  [
    'inner_compass',
    'https://drive.google.com/file/d/REPLACE_INNER_COMPASS_PDF/view?usp=sharing',
    'بوصلتك الداخلية',
  ],
  [
    'voltaren_social',
    'https://drive.google.com/file/d/REPLACE_VOLTAREN_PDF/view?usp=sharing',
    'فولتارين السوشيال ميديا',
  ],
];

const MESSAGE_LOG_HEADER = [
  ['timestamp', 'phone', 'message', 'keyword_matched', 'reply_sent', 'status', 'message_id'],
];

function saveTokens(credentials) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2), 'utf8');
  console.log('Saved tokens to google-tokens.json (keep private)');
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function authorizeInteractive() {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    console.log('\nافتحي هذا الرابط إن لم يفتح المتصفح:');
    console.log(authUrl);
    console.log('');

    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;
        res.end('<h2>تم التفويض. يمكنك إغلاق هذه النافذة.</h2>');
        server.close();

        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          saveTokens(tokens);
          resolve(oauth2Client);
        } catch (err) {
          reject(err);
        }
      }
    });

    server.listen(3000, () => {
      try {
        require('open')(authUrl);
      } catch (_) {}
    });
  });
}

async function getAuthenticatedClient() {
  const stored = loadTokens();
  if (stored && stored.refresh_token) {
    oauth2Client.setCredentials(stored);
    try {
      await oauth2Client.getAccessToken();
      saveTokens(oauth2Client.credentials);
      return oauth2Client;
    } catch (e) {
      console.log('انتهت صلاحية التوكن أو خطأ تحديث:', e.message);
      console.log('إعادة تسجيل الدخول...\n');
    }
  }
  return authorizeInteractive();
}

async function ensureSheetExists(sheets, spreadsheetId, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map((s) => s.properties.title);

  if (!existing.includes(sheetTitle)) {
    console.log(`إنشاء تبويب: ${sheetTitle}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    });
  }
}

async function syncBotPdfAndMessageLog(sheets) {
  console.log('\n--- ملف البوت (WhatsApp Bot Data) ---');
  console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);

  await ensureSheetExists(sheets, SPREADSHEET_ID, BOT_PDF_SHEET);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${BOT_PDF_SHEET}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${BOT_PDF_SHEET}!A1:D${PDF_TABLE.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: PDF_TABLE },
  });
  console.log(`✓ تبويب "${BOT_PDF_SHEET}": أعمدة product_code | label_ar | pdf_url | ملاحظة + صفّان مثال`);

  await ensureSheetExists(sheets, SPREADSHEET_ID, 'message_log');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'message_log!A1:G1',
    valueInputOption: 'RAW',
    requestBody: { values: MESSAGE_LOG_HEADER },
  });
  console.log('✓ تبويب message_log: صف العناوين يتضمن message_id (لم يُمسّ صفوف البيانات من الصف 2+)');
}

async function syncPaymentProductMap(sheets) {
  console.log('\n--- ملف الدفع (عمليات الدفع) ---');
  console.log(`https://docs.google.com/spreadsheets/d/${PAYMENT_SPREADSHEET_ID}/edit`);

  await ensureSheetExists(sheets, PAYMENT_SPREADSHEET_ID, 'product_pdf_map');

  await sheets.spreadsheets.values.update({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: 'product_pdf_map!A1:C1',
    valueInputOption: 'RAW',
    requestBody: { values: PRODUCT_PDF_MAP_HEADERS },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: `product_pdf_map!A2:C${1 + PRODUCT_PDF_MAP_ROWS.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: PRODUCT_PDF_MAP_ROWS },
  });
  console.log('✓ تبويب product_pdf_map: product_code | pdf_url | label_ar');

  console.log(`
⚠ تبويب "عمليات الدفع" مربوط بالفورم — لا يُضاف عمود product_code من السكربت حتى لا تختلط الأعمدة.
   من Google Form أضيفي سؤالًا بعنوان بالظبط: product_code
   (قائمة منسدلة: inner_compass ، voltaren_social — نفس الأكواد أعلاه).
`);
}

(async () => {
  try {
    console.log('مزامنة الشيتات الحية — Google Sheets API');
    console.log('==========================================');
    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: 'v4', auth });

    await syncBotPdfAndMessageLog(sheets);
    await syncPaymentProductMap(sheets);

    console.log('\n✅ تم. حدّثي روابط REPLACE_* في التبويبين بعد رفع ملفات PDF.');
  } catch (err) {
    console.error('\n❌ خطأ:', err.message);
    process.exit(1);
  }
})();
