/**
 * Adds missing tabs/columns to existing Excel workbooks (preserves data).
 * Run: npm run patch:excel
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const MATCH_COL_TIMESTAMP = 'طابع زمني';

const PAUSED_CHATS_HEADERS = ['phone', 'paused_at', 'last_human_at', 'expires_at', 'reason', 'active'];
const BOT_OUTBOUND_HEADERS = ['message_id', 'phone', 'source', 'sent_at'];
const MESSAGE_LOG_HEADERS = [
  'timestamp',
  'phone',
  'message',
  'keyword_matched',
  'reply_sent',
  'status',
  'message_id'
];
const EMAIL_LEADS_HEADERS = [
  'created_at',
  'last_seen_at',
  'email',
  'phone',
  'name_hint',
  'intent_type',
  'latest_message',
  'message_id',
  'source',
  'status'
];
const EMAIL_LEADS_STRAY = new Set(['done', 'whatsapp_status', 'sent_at']);

const PAYMENT_AUTOMATION_COLS = [
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
  'lock_owner'
];

const PAYMENT_OPTIONAL_FORM_COLS = ['محتاج اي ', 'محتاج اي', 'محتاج أي'];

const DEFAULT_PATHS = [
  path.join(root, 'WhatsApp Bot Data.xlsx'),
  path.join(root, 'عمليات الدفع.xlsx'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'WhatsApp Bot Data (6).xlsx'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'عمليات الدفع (4).xlsx')
];

function normHeader(h) {
  return String(h ?? '').trim();
}

function sheetToAoa(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function aoaToSheet(aoa) {
  return XLSX.utils.aoa_to_sheet(aoa);
}

function ensureSheet(wb, name, headerRow) {
  if (!wb.SheetNames.includes(name)) {
    const ws = aoaToSheet([headerRow]);
    XLSX.utils.book_append_sheet(wb, ws, name);
    return { action: 'created_tab', tab: name };
  }
  return null;
}

/** Insert missing columns into header row; extend each data row with empty cells */
function ensureColumns(aoa, requiredHeaders) {
  if (!aoa.length) {
    return { aoa: [requiredHeaders], added: requiredHeaders };
  }
  const headers = aoa[0].map(normHeader);
  const headerIndex = new Map(headers.map((h, i) => [h.toLowerCase(), i]));
  const added = [];

  for (const col of requiredHeaders) {
    const key = col.toLowerCase();
    if (!headerIndex.has(key)) {
      headers.push(col);
      headerIndex.set(key, headers.length - 1);
      added.push(col);
    }
  }

  if (!added.length) {
    return { aoa, added: [] };
  }

  const newAoa = [headers];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const newRow = headers.map((h) => {
      const oldIdx = aoa[0].map(normHeader).indexOf(normHeader(h));
      return oldIdx >= 0 ? (row[oldIdx] ?? '') : '';
    });
    newAoa.push(newRow);
  }
  return { aoa: newAoa, added };
}

/** Reorder/filter email_leads to canonical headers; drop stray payment columns */
function normalizeEmailLeads(aoa) {
  if (!aoa.length) return { aoa: [EMAIL_LEADS_HEADERS], note: 'empty_sheet_headers_only' };
  const oldHeaders = aoa[0].map(normHeader);
  const idxByHeader = new Map(oldHeaders.map((h, i) => [h.toLowerCase(), i]));
  const removed = oldHeaders.filter((h) => EMAIL_LEADS_STRAY.has(h.toLowerCase()));

  const newAoa = [EMAIL_LEADS_HEADERS];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    newAoa.push(
      EMAIL_LEADS_HEADERS.map((h) => {
        const i = idxByHeader.get(h.toLowerCase());
        return i !== undefined ? (row[i] ?? '') : '';
      })
    );
  }
  return {
    aoa: newAoa,
    note: removed.length ? `removed_stray_columns:${removed.join(',')}` : 'reordered_headers'
  };
}

function patchBotWorkbook(filePath) {
  if (!fs.existsSync(filePath)) return { file: filePath, skip: 'file_not_found' };

  const wb = XLSX.readFile(filePath);
  const changes = [];

  for (const [tab, headers] of [
    ['paused_chats', PAUSED_CHATS_HEADERS],
    ['bot_outbound', BOT_OUTBOUND_HEADERS]
  ]) {
    const r = ensureSheet(wb, tab, headers);
    if (r) changes.push(r);
  }

  if (wb.SheetNames.includes('message_log')) {
    const aoa = sheetToAoa(wb.Sheets.message_log);
    const { aoa: fixed, added } = ensureColumns(aoa, MESSAGE_LOG_HEADERS);
    if (added.length) {
      wb.Sheets.message_log = aoaToSheet(fixed);
      changes.push({ action: 'added_columns', tab: 'message_log', columns: added });
    }
  } else {
    ensureSheet(wb, 'message_log', MESSAGE_LOG_HEADERS);
    changes.push({ action: 'created_tab', tab: 'message_log' });
  }

  if (wb.SheetNames.includes('email_leads')) {
    const aoa = sheetToAoa(wb.Sheets.email_leads);
    const { aoa: fixed, note } = normalizeEmailLeads(aoa);
    const before = JSON.stringify(aoa[0] || []);
    const after = JSON.stringify(fixed[0] || []);
    if (before !== after) {
      wb.Sheets.email_leads = aoaToSheet(fixed);
      changes.push({ action: 'normalized_email_leads', tab: 'email_leads', note });
    }
  }

  if (changes.length) {
    XLSX.writeFile(wb, filePath);
  }
  return { file: filePath, changes: changes.length ? changes : ['already_complete'] };
}

function patchPaymentWorkbook(filePath) {
  if (!fs.existsSync(filePath)) return { file: filePath, skip: 'file_not_found' };

  const wb = XLSX.readFile(filePath);
  const changes = [];
  const payTab = 'عمليات الدفع';

  if (!wb.SheetNames.includes(payTab)) {
    return { file: filePath, skip: 'missing_tab_عمليات_الدفع' };
  }

  let aoa = sheetToAoa(wb.Sheets[payTab]);
  if (!aoa.length) aoa = [[]];

  const headers = aoa[0].map(normHeader);
  const lower = new Set(headers.map((h) => h.toLowerCase()));

  const hasProductCol = headers.some((h) => h.toLowerCase() === 'product_code');
  const hasNeedCol = PAYMENT_OPTIONAL_FORM_COLS.some((c) => lower.has(c.toLowerCase().trim()));

  const toAdd = [];
  if (!hasNeedCol) toAdd.push('محتاج اي ');
  for (const c of PAYMENT_AUTOMATION_COLS) {
    if (!lower.has(c.toLowerCase())) toAdd.push(c);
  }

  if (toAdd.length) {
    const insertBefore = headers.findIndex((h) => h.toLowerCase() === 'product_code');
    const insertAt = insertBefore >= 0 ? insertBefore : headers.length;
    const newHeaders = [...headers];
    newHeaders.splice(insertAt, 0, ...toAdd);

    const newAoa = [newHeaders];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const oldMap = new Map(headers.map((h, i) => [normHeader(h).toLowerCase(), row[i] ?? '']));
      newAoa.push(newHeaders.map((h) => oldMap.get(normHeader(h).toLowerCase()) ?? ''));
    }
    wb.Sheets[payTab] = aoaToSheet(newAoa);
    changes.push({ action: 'added_columns', tab: payTab, columns: toAdd });
  }

  if (!wb.SheetNames.includes('product_pdf_map')) {
    ensureSheet(wb, 'product_pdf_map', ['product_code', 'pdf_url', 'label_ar']);
    changes.push({ action: 'created_tab', tab: 'product_pdf_map' });
  }

  if (changes.length) {
    XLSX.writeFile(wb, filePath);
  }
  return { file: filePath, changes: changes.length ? changes : ['already_complete'] };
}

function isBotFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base.includes('whatsapp bot') || base.includes('bot data');
}

function isPaymentFile(filePath) {
  const base = path.basename(filePath);
  return base.includes('عمليات') || base.toLowerCase().includes('payment');
}

const args = process.argv.slice(2);
const paths = args.length ? args : DEFAULT_PATHS.filter((p) => fs.existsSync(p));

const seen = new Set();
const results = [];

for (const filePath of paths) {
  const abs = path.resolve(filePath);
  if (seen.has(abs)) continue;
  seen.add(abs);

  if (isBotFile(abs)) results.push(patchBotWorkbook(abs));
  else if (isPaymentFile(abs)) results.push(patchPaymentWorkbook(abs));
}

console.log(JSON.stringify(results, null, 2));
