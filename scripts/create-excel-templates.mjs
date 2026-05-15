/**
 * Creates local Excel copies aligned with your Google Sheets / Forms layout.
 * Bot file: keywords + PDF reference + message_log + email_leads.
 * Payment file: عمليات الدفع (Form columns + product_code + automation) + product_pdf_map.
 *
 * Run: npm run create:excel-templates
 */
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

/** Must match MATCH_COL_TIMESTAMP in scripts/build-full-whatsapp-workflow.mjs */
const MATCH_COL_TIMESTAMP = 'طابع زمني';

/* ---------- WhatsApp Bot Data (main bot spreadsheet) ---------- */

const KEYWORDS_HEADERS = [['keyword', 'reply', 'active']];
const KEYWORDS_DATA = [
  [
    'hello, hi, مرحبا, أهلاً, أهلا, هاي, السلام',
    '👋 Hello! How can we help you today? Reply with *price*, *location*, or *hours*.',
    'TRUE',
  ],
  [
    'price, prices, سعر, الأسعار, بكام, كام',
    '💰 Our pricing:\n- Service A: $50\n- Service B: $80\nReply to book!',
    'TRUE',
  ],
  [
    'location, address, عنوان, فين, وين',
    '📍 Address: 123 Main St\nGoogle Maps: https://maps.app.goo.gl/YOURLINK',
    'TRUE',
  ],
  [
    'hours, working hours, مواعيد, ساعات, امتى',
    '🕐 Working hours: Sat–Thu, 9am–6pm. Fri: closed.',
    'TRUE',
  ],
  [
    'human, agent, موظف, كلمني, واحد',
    '👤 Got it! A team member will reach out shortly. Please hold. 🙏',
    'TRUE',
  ],
  [
    'default',
    "😊 Sorry, didn't catch that! Reply with:\n*price* 💰 *location* 📍 *hours* 🕐",
    'TRUE',
  ],
];

/** مرجع الكتب (للفريق): نفس أكواد الـ Form؛ رابط التحميل الحقيقي يُنسَخ أيضًا في ملف الدفع → product_pdf_map */
const PDF_REFERENCE_HEADERS = [['product_code', 'label_ar', 'pdf_url', 'ملاحظة']];
const PDF_REFERENCE_ROWS = [
  [
    'inner_compass',
    'كتاب بوصلتك الداخلية',
    'https://drive.google.com/file/d/REPLACE_INNER_COMPASS_PDF/view?usp=sharing',
    'استبدلي REPLACE بمعرّف ملف PDF الحقيقي (مشاركة: أي شخص لديه الرابط)',
  ],
  [
    'voltaren_social',
    'كتاب فولتارين السوشيال ميديا',
    'https://drive.google.com/file/d/REPLACE_VOLTAREN_PDF/view?usp=sharing',
    'نسّقي الأكواد مع قائمة الفورم product_code',
  ],
];

const MESSAGE_LOG_HEADERS = [
  ['timestamp', 'phone', 'message', 'keyword_matched', 'reply_sent', 'status', 'message_id'],
];

const MESSAGE_LOG_EXAMPLES = [
  [
    '2025-04-30T11:05:17.000Z',
    '2010998877666',
    'مرحبا',
    'hello, hi, مرحبا, أهلاً, أهلا, هاي, السلام',
    '👋 Hello! How can we help you today?',
    'sent',
    '3EB0ABC123DEF456',
  ],
  [
    '2025-05-01T08:30:00.000Z',
    '201501188886',
    'مرحبا، عايزة اشتري كتاب بوصلتك الداخلية 🦭 السعر: $9 ممكن تبعتيلي طرق الدفع؟',
    '',
    '',
    'logged',
    '3EB0XYZ999AAA001',
  ],
];

const EMAIL_LEADS_HEADERS = [
  [
    'created_at',
    'last_seen_at',
    'email',
    'phone',
    'name_hint',
    'intent_type',
    'latest_message',
    'message_id',
    'source',
    'status',
  ],
];

const PAUSED_CHATS_HEADERS = [['phone', 'paused_at', 'last_human_at', 'expires_at', 'reason', 'active']];

const BOT_OUTBOUND_HEADERS = [['message_id', 'phone', 'source', 'sent_at']];

const EMAIL_LEADS_EXAMPLES = [
  [
    '2025-04-30T11:05:17.000Z',
    '2025-04-30T11:05:17.000Z',
    'ahmed.mohamed@example.com',
    '2010998877666',
    'أحمد',
    'chat',
    'عايز أعرف السعر',
    '3EB0ABC123DEF456',
    'whatsapp',
    'new',
  ],
  [
    '2025-05-01T08:30:00.000Z',
    '2025-05-01T08:30:00.000Z',
    'yassmin.client@gmail.com',
    '201501188886',
    'سارة',
    'book_purchase',
    'مرحبا، عايزة اشتري كتاب بوصلتك الداخلية',
    '3EB0XYZ999AAA001',
    'whatsapp',
    'new',
  ],
];

/* ---------- Payment spreadsheet (Form + automation + PDF map) ---------- */

const PAYMENT_SHEET = 'عمليات الدفع';

/**
 * ترتيب يطابق فورم الدفع الشائع + عمود product_code للـ n8n + أعمدة الأتمتة.
 * (مسافات أسماء الأعمدة كما في تصدير Google غالبًا)
 */
const PAYMENT_HEADERS = [
  MATCH_COL_TIMESTAMP,
  'الاسم ',
  'البريد الالكتروني',
  'طرق الدفع',
  'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله',
  'رفع صوره الايصال ',
  'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله 2',
  'محتاج اي ',
  'product_code',
  'done',
  'whatsapp_status',
  'whatsapp_last_error',
  'whatsapp_sent_at',
  'retry_count',
  'max_retries',
  'dead_letter',
  'next_retry_at',
  'locked_at',
  'lock_owner',
];

/** صف 1: رد جديد — Done فاضي؛ الأتمتة لا ترسل حتى يتم التأكيد */
const PAYMENT_ROW_PENDING = [
  '01/05/2026 03:12:22',
  'أحمد',
  'mosfata@gmail.com',
  'فودافون كاش/انستا باي',
  '01501188886',
  'https://drive.google.com/open?id=EXAMPLE_RECEIPT_REPLACE',
  '',
  'كتاب بوصلتك الداخلية',
  'inner_compass',
  '',
  '',
  '',
  '',
  '0',
  '3',
  'FALSE',
  '',
  '',
  '',
];

/** صف 2: بعد التأكيد والإرسال الناجح */
const PAYMENT_ROW_SENT = [
  '30/04/2026 10:00:00',
  'سارة',
  'client@example.com',
  'فودافون كاش/انستا باي',
  '01501188886',
  'https://drive.google.com/open?id=EXAMPLE_RECEIPT_2',
  '01501188886',
  'كتاب فولتارين السوشيال ميديا',
  'voltaren_social',
  'TRUE',
  'sent',
  '',
  '2026-04-30T23:49:32.132Z',
  '0',
  '3',
  'FALSE',
  '',
  '',
  '',
];

/** صف 3: Done لكن في انتظار الإرسال (فشل مؤقت سابقًا) */
const PAYMENT_ROW_RETRY = [
  '28/04/2026 09:00:00',
  'محمود',
  'test@example.com',
  'للدفع من خارج مصر',
  '01090321007',
  '',
  '',
  'كتاب بوصلتك الداخلية',
  'inner_compass',
  'done',
  'failed',
  'timeout',
  '',
  '1',
  '3',
  'FALSE',
  '',
  '',
  '',
];

const PRODUCT_PDF_MAP_SHEET = 'product_pdf_map';
const PRODUCT_PDF_MAP_ROWS = [
  ['product_code', 'pdf_url', 'label_ar'],
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

function setColWidths(ws, count, wch = 16) {
  ws['!cols'] = Array.from({ length: count }, () => ({ wch }));
}

function writeBotData(outPath) {
  const wb = XLSX.utils.book_new();

  const wsKw = XLSX.utils.aoa_to_sheet([...KEYWORDS_HEADERS, ...KEYWORDS_DATA]);
  setColWidths(wsKw, 3, 22);
  XLSX.utils.book_append_sheet(wb, wsKw, 'keywords');

  const wsPdf = XLSX.utils.aoa_to_sheet([...PDF_REFERENCE_HEADERS, ...PDF_REFERENCE_ROWS]);
  setColWidths(wsPdf, 4, 28);
  XLSX.utils.book_append_sheet(wb, wsPdf, 'PDF');

  const wsLog = XLSX.utils.aoa_to_sheet([...MESSAGE_LOG_HEADERS, ...MESSAGE_LOG_EXAMPLES]);
  setColWidths(wsLog, 7, 16);
  XLSX.utils.book_append_sheet(wb, wsLog, 'message_log');

  const wsLeads = XLSX.utils.aoa_to_sheet([...EMAIL_LEADS_HEADERS, ...EMAIL_LEADS_EXAMPLES]);
  setColWidths(wsLeads, 10, 18);
  XLSX.utils.book_append_sheet(wb, wsLeads, 'email_leads');

  const wsPaused = XLSX.utils.aoa_to_sheet([...PAUSED_CHATS_HEADERS]);
  setColWidths(wsPaused, 6, 20);
  XLSX.utils.book_append_sheet(wb, wsPaused, 'paused_chats');

  const wsOutbound = XLSX.utils.aoa_to_sheet([...BOT_OUTBOUND_HEADERS]);
  setColWidths(wsOutbound, 4, 22);
  XLSX.utils.book_append_sheet(wb, wsOutbound, 'bot_outbound');

  XLSX.writeFile(wb, outPath);
}

function writePayment(outPath) {
  const wb = XLSX.utils.book_new();
  const payRows = [PAYMENT_HEADERS, PAYMENT_ROW_PENDING, PAYMENT_ROW_SENT, PAYMENT_ROW_RETRY];
  const ws = XLSX.utils.aoa_to_sheet(payRows);
  setColWidths(ws, PAYMENT_HEADERS.length, 20);
  XLSX.utils.book_append_sheet(wb, ws, PAYMENT_SHEET);

  const wsMap = XLSX.utils.aoa_to_sheet(PRODUCT_PDF_MAP_ROWS);
  setColWidths(wsMap, 3, 26);
  XLSX.utils.book_append_sheet(wb, wsMap, PRODUCT_PDF_MAP_SHEET);

  XLSX.writeFile(wb, outPath);
}

const botPath = path.join(root, 'WhatsApp Bot Data.xlsx');
const payPath = path.join(root, 'عمليات الدفع.xlsx');

writeBotData(botPath);
writePayment(payPath);

console.log('Wrote Excel templates:');
console.log(' ', botPath);
console.log('   sheets: keywords | PDF | message_log | email_leads | paused_chats | bot_outbound');
console.log(' ', payPath);
console.log(`   sheets: "${PAYMENT_SHEET}" | "${PRODUCT_PDF_MAP_SHEET}"`);
console.log('   عمليات الدفع:', PAYMENT_HEADERS.length, 'columns (Form + product_code + automation)');
console.log('   product_pdf_map: product_code | pdf_url | label_ar');
console.log('\nاستبدلي REPLACE_* و EXAMPLE_* بروابط وملفات حقيقية؛ انسخ التبويبات إلى Google Sheets المناسبة.');
