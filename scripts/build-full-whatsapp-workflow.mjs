/**
 * Merges whatsapp-bot + payment sources into full-whatsapp-bot-yassmin-workflow.json
 * (canonical file for n8n import — single workflow). Also writes whatsapp-payment-confirmation-workflow.json as a derived slice for reference only.
 *
 * Payment path: Cron → read "عمليات الدفع" + "product_pdf_map" (Merge append) → Code → fixed confirmation + PDF URL from map by Form column product_code.
 * No template sheets, no $env / process in Code node (n8n 2.x task runner often blocks env access).
 * Payment HTTP apikey header is copied from bot node "HTTP: Send Reply" (no $env in expressions).
 *
 * Payment sends always use Evolution instance below (fixed URL + Code; not read from sheet).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PAYMENT_OPS_DOC_ID = '1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w';
const PAYMENT_OPS_SHEET_NAME = 'عمليات الدفع';
const MATCH_COL_TIMESTAMP = 'طابع زمني';

/** Google Form question title = column on عمليات الدفع (use dropdown values matching product_code). */
const FORM_PRODUCT_CODE_COLUMN = 'product_code';

/** Lookup tab on same payment spreadsheet: product_code → pdf_url */
const PRODUCT_PDF_MAP_SHEET_NAME = 'product_pdf_map';

/** Fixed Evolution instance for payment confirmations (must match your Evolution manager). */
const DEFAULT_EVOLUTION_INSTANCE = 'Yas';

const EVOLUTION_PAYMENT_SEND_BASE = 'https://evolution.growleadpro.com/message/sendText/';

const SHEETS_CRED = {
  googleSheetsOAuth2Api: { id: 'HL2oexu75XGQWtzz', name: 'Google Sheets account' }
};

const bot = JSON.parse(fs.readFileSync(path.join(root, 'whatsapp-bot-n8n-workflow.json'), 'utf8'));
const payment = JSON.parse(fs.readFileSync(path.join(root, 'whatsapp-payment-confirmation-workflow.json'), 'utf8'));

const newFilterCode = `const ALL_ROWS = $input.all().map(i => i.json);
const MATCH_COL = ${JSON.stringify(MATCH_COL_TIMESTAMP)};
const PRODUCT_COL = ${JSON.stringify(FORM_PRODUCT_CODE_COLUMN)};
const FIXED_CONFIRMATION = 'تم تأكيد الدفع.';
const DEFAULT_INSTANCE = ${JSON.stringify(DEFAULT_EVOLUTION_INSTANCE)};

const rows = ALL_ROWS.filter((row) => String(row[MATCH_COL] ?? '').trim() !== '');
const mapSourceRows = ALL_ROWS.filter((row) => {
  const code = String(row.product_code ?? '').trim();
  const url = String(row.pdf_url ?? '').trim();
  return code !== '' && url !== '' && String(row[MATCH_COL] ?? '').trim() === '';
});

function isDone(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return ['true', 'tru', '1', 'yes', 'done'].includes(s);
}

function pickDoneCell(r) {
  const direct = r.Done ?? r.done ?? r.DONE;
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') return direct;
  for (const k of Object.keys(r)) {
    if (String(k).trim().toLowerCase() === 'done') return r[k];
  }
  return '';
}

function pickWhatsappPhoneFromRow(r) {
  for (const k of Object.keys(r)) {
    if (/واتس|whatsapp|phone|رقم/i.test(k) && /\\d/.test(String(r[k] ?? ''))) return r[k];
  }
  return r.phone ?? r.Phone ?? '';
}

function normalizeFormPhone(v) {
  let d = String(v ?? '').replace(/\\D/g, '');
  if (!d) return '';
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

function isValidEgWhatsappPhone(phone) {
  return /^20\\d{10}$/.test(phone);
}

function isPhonePaused(phone) {
  let pausedRows = [];
  try {
    pausedRows = $('Sheets: Read Paused Chats (Payment)').all().map((i) => i.json);
  } catch (_) {
    pausedRows = [];
  }
  const p = normalizeFormPhone(phone);
  if (!p) return false;
  const now = Date.now();
  for (const r of pausedRows) {
    if (normalizeFormPhone(r.phone) !== p) continue;
    if (String(r.active ?? '').trim().toUpperCase() !== 'TRUE') continue;
    const exp = new Date(r.expires_at).getTime();
    if (Number.isFinite(exp) && exp > now) return true;
  }
  return false;
}

function parseNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const lockOwner = 'payment-confirmation-cron';
const lockTimeoutMinutes = 30;
const maxRetriesDefault = 3;

function normKey(s) {
  return String(s ?? '').trim().toLowerCase();
}
const pdfByCode = {};
for (const m of mapSourceRows) {
  const c = normKey(m.product_code);
  const u = String(m.pdf_url ?? '').trim();
  if (c && u) pdfByCode[c] = u;
}
function pickProductCodeFromRow(r) {
  const direct = r[PRODUCT_COL];
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct).trim();
  for (const k of Object.keys(r)) {
    if (normKey(k) === normKey(PRODUCT_COL)) return String(r[k] ?? '').trim();
  }
  return '';
}

const out = [];

for (const r of rows) {
  const done = isDone(pickDoneCell(r));
  const status = String(r.whatsapp_status ?? '').trim().toLowerCase();
  const retryCount = parseNumber(r.retry_count, 0);
  let maxRetries = parseNumber(r.max_retries, maxRetriesDefault);
  if (!Number.isFinite(maxRetries) || maxRetries <= 0) maxRetries = maxRetriesDefault;
  const deadLetter = String(r.dead_letter ?? '').trim().toLowerCase() === 'true';
  const nextRetryAt = String(r.next_retry_at ?? '').trim();
  const lockedAt = String(r.locked_at ?? '').trim();
  const currentLockOwner = String(r.lock_owner ?? '').trim();

  if (!done) continue;
  if (status === 'sent' || status === 'dead_letter' || deadLetter) continue;

  const matchKey = String(r[MATCH_COL] ?? '').trim();
  let phone = normalizeFormPhone(pickWhatsappPhoneFromRow(r));
  const targetInstance = String(DEFAULT_INSTANCE).trim();

  let precheckError = '';
  if (!matchKey) precheckError = 'missing_form_timestamp';
  else if (!phone) precheckError = 'missing_phone';
  else if (!isValidEgWhatsappPhone(phone)) precheckError = 'invalid_phone_format_expected_20XXXXXXXXXX';
  else if (retryCount >= maxRetries) precheckError = 'max_retries_reached';
  else if (nextRetryAt && new Date(nextRetryAt).getTime() > Date.now()) precheckError = 'waiting_next_retry_window';
  else if (lockedAt && currentLockOwner && currentLockOwner !== lockOwner && new Date(lockedAt).getTime() > new Date(minutesAgoIso(lockTimeoutMinutes)).getTime()) precheckError = 'locked_by_other_worker';
  else if (isPhonePaused(phone)) precheckError = 'human_handoff_paused';

  const shouldSend = precheckError === '';
  const attemptStartedAt = new Date().toISOString();

  const productCodeNorm = normKey(pickProductCodeFromRow(r));
  const pdfUrl = productCodeNorm ? (pdfByCode[productCodeNorm] || '') : '';
  const confirmation_text = pdfUrl
    ? FIXED_CONFIRMATION + '\\n\\nرابط تحميل الكتاب (PDF):\\n' + pdfUrl
    : FIXED_CONFIRMATION + '\\n\\nلم يُعثر على رابط PDF لهذا الكتاب؛ سنتواصل معك لاحقًا.';

  out.push({
    json: {
      ...r,
      phone,
      target_instance: targetInstance,
      confirmation_text,
      pdf_url: pdfUrl,
      product_code: pickProductCodeFromRow(r),
      processed_at: attemptStartedAt,
      attempt_started_at: attemptStartedAt,
      retry_count: retryCount,
      max_retries: maxRetries,
      lock_owner: shouldSend ? lockOwner : currentLockOwner,
      locked_at: shouldSend ? attemptStartedAt : lockedAt,
      should_send: shouldSend,
      precheck_error: precheckError,
      event_type: 'payment_confirmation',
      stage: shouldSend ? 'ready_to_send' : 'precheck_failed',
      result: shouldSend ? 'pending' : 'failed',
      error_code: precheckError,
      latency_ms: 0
    }
  });
}

return out;`;

function schemaCol(id, type = 'string', defaultMatch = false) {
  return {
    id,
    displayName: id,
    required: false,
    defaultMatch,
    type,
    display: true
  };
}

function patchPaymentSpreadsheetNodes(nodes) {
  const doc = { __rl: true, value: PAYMENT_OPS_DOC_ID, mode: 'id' };
  const opsSheet = { __rl: true, value: PAYMENT_OPS_SHEET_NAME, mode: 'name' };
  const ts = MATCH_COL_TIMESTAMP;

  for (const n of nodes) {
    if (n.name === 'Sheets: Read Payment Rows') {
      n.parameters.documentId = { ...doc };
      n.parameters.sheetName = { ...opsSheet };
      n.notes =
        'Tab "' +
        PAYMENT_OPS_SHEET_NAME +
        '". Google Form must include column "' +
        FORM_PRODUCT_CODE_COLUMN +
        '" (dropdown codes). Done → confirmation + PDF from tab "' +
        PRODUCT_PDF_MAP_SHEET_NAME +
        '". Evolution instance: ' +
        DEFAULT_EVOLUTION_INSTANCE +
        '.';
    }

    if (n.name === 'Sheets: Read Product PDF Map') {
      n.parameters.documentId = { ...doc };
      n.parameters.sheetName = { __rl: true, value: PRODUCT_PDF_MAP_SHEET_NAME, mode: 'name' };
      n.parameters.options = { ...(n.parameters.options || {}), returnAllMatches: true };
      n.notes =
        'Rows: product_code | pdf_url | label_ar (optional). Codes must match Form column "' +
        FORM_PRODUCT_CODE_COLUMN +
        '" on عمليات الدفع.';
    }

    if (n.name === 'Sheets: Mark Sent') {
      n.parameters.documentId = { ...doc };
      n.parameters.sheetName = { ...opsSheet };
      n.parameters.columns = {
        mappingMode: 'defineBelow',
        value: {
          [ts]: `={{ $('Code: Filter Eligible Rows').item.json[${JSON.stringify(ts)}] }}`,
          whatsapp_status: 'sent',
          whatsapp_last_error: '',
          whatsapp_sent_at: "={{ $('Code: Filter Eligible Rows').item.json.processed_at }}"
        },
        matchingColumns: [ts],
        schema: [
          schemaCol(ts, 'string', true),
          schemaCol('whatsapp_status'),
          schemaCol('whatsapp_last_error'),
          schemaCol('whatsapp_sent_at')
        ]
      };
    }

    if (n.name === 'Sheets: Mark Failed') {
      n.parameters.documentId = { ...doc };
      n.parameters.sheetName = { ...opsSheet };
      n.parameters.columns = {
        mappingMode: 'defineBelow',
        value: {
          [ts]: `={{ $('Code: Filter Eligible Rows').item.json[${JSON.stringify(ts)}] }}`,
          whatsapp_status: 'failed',
          whatsapp_last_error: "={{ $json.precheck_error || $json.error?.message || 'send_failed' }}"
        },
        matchingColumns: [ts],
        schema: [schemaCol(ts, 'string', true), schemaCol('whatsapp_status'), schemaCol('whatsapp_last_error')]
      };
    }
  }
}

/** Plain apikey from bot workflow (n8n often denies `$env` in HTTP header expressions). */
function evolutionApiKeyFromBotNodes(botNodes) {
  const n = botNodes.find((x) => x.name === 'HTTP: Send Reply');
  const list = n?.parameters?.headerParameters?.parameters;
  if (!Array.isArray(list)) return '';
  const row = list.find((p) => String(p?.name || '').toLowerCase() === 'apikey');
  const v = row?.value;
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t || /\$env/.test(t)) return '';
  return t;
}

function patchPaymentEvolutionApikey(nodes, apiKey) {
  if (!apiKey) {
    console.warn(
      'Warning: no plain Evolution apikey on bot "HTTP: Send Reply" — set apikey on HTTP: Send Payment Confirmation manually.'
    );
    return;
  }
  for (const n of nodes) {
    if (n.name !== 'HTTP: Send Payment Confirmation') continue;
    const hdr = n.parameters?.headerParameters?.parameters;
    if (!Array.isArray(hdr)) continue;
    const row = hdr.find((p) => String(p?.name || '').toLowerCase() === 'apikey');
    if (row) row.value = apiKey;
  }
}

function patchPaymentHttpSendUrl(nodes) {
  const url = `=${EVOLUTION_PAYMENT_SEND_BASE}${DEFAULT_EVOLUTION_INSTANCE}`;
  for (const n of nodes) {
    if (n.name !== 'HTTP: Send Payment Confirmation') continue;
    n.parameters.url = url;
  }
}

const STRIP_NODES = new Set(['Sheets: Read Done Templates', 'Sheets: Read Intent Done Map']);

const payNodes = payment.nodes.filter((n) => !STRIP_NODES.has(n.name));
const readPayIdx = payNodes.findIndex((n) => n.name === 'Sheets: Read Payment Rows');

if (readPayIdx < 0) throw new Error('Expected Sheets: Read Payment Rows in payment workflow');
if (!payNodes.some((n) => n.name === 'Sheets: Read Product PDF Map')) {
  throw new Error('Expected node Sheets: Read Product PDF Map in whatsapp-payment-confirmation-workflow.json');
}
if (!payNodes.some((n) => n.name === 'Merge: Payments And Product Map')) {
  throw new Error('Expected node Merge: Payments And Product Map in whatsapp-payment-confirmation-workflow.json');
}

const reorderedPaymentNodes = [...payNodes];

const filterNode = reorderedPaymentNodes.find((n) => n.name === 'Code: Filter Eligible Rows');
filterNode.parameters.jsCode = newFilterCode;

patchPaymentSpreadsheetNodes(reorderedPaymentNodes);
patchPaymentEvolutionApikey(reorderedPaymentNodes, evolutionApiKeyFromBotNodes(bot.nodes));
patchPaymentHttpSendUrl(reorderedPaymentNodes);

const readPay = reorderedPaymentNodes.find((n) => n.name === 'Sheets: Read Payment Rows');
const readMap = reorderedPaymentNodes.find((n) => n.name === 'Sheets: Read Product PDF Map');
const mergePay = reorderedPaymentNodes.find((n) => n.name === 'Merge: Payments And Product Map');
if (readPay) readPay.position = [-1728, 1064];
if (readMap) readMap.position = [-1728, 760];
if (mergePay) mergePay.position = [-1540, 912];
const filt = reorderedPaymentNodes.find((n) => n.name === 'Code: Filter Eligible Rows');
if (filt) filt.position = [-1320, 912];

const baseConnections = {};
for (const [k, v] of Object.entries(payment.connections)) {
  if (STRIP_NODES.has(k)) continue;
  baseConnections[k] = v;
}

const payConnections = {
  ...baseConnections,
  'Cron: Every 30 Minutes': {
    main: [
      [
        { node: 'Sheets: Read Payment Rows', type: 'main', index: 0 },
        { node: 'Sheets: Read Product PDF Map', type: 'main', index: 0 },
        { node: 'Sheets: Read Paused Chats (Payment)', type: 'main', index: 0 }
      ]
    ]
  },
  'Sheets: Read Payment Rows': {
    main: [[{ node: 'Merge: Payments And Product Map', type: 'main', index: 0 }]]
  },
  'Sheets: Read Product PDF Map': {
    main: [[{ node: 'Merge: Payments And Product Map', type: 'main', index: 1 }]]
  },
  'Merge: Payments And Product Map': {
    main: [[{ node: 'Code: Filter Eligible Rows', type: 'main', index: 0 }]]
  }
};

const botIds = new Set(bot.nodes.map((n) => n.id));
for (const n of reorderedPaymentNodes) {
  if (botIds.has(n.id)) throw new Error(`Duplicate node id across workflows: ${n.id} (${n.name})`);
  botIds.add(n.id);
}

const out = {
  name: 'FULL WhatsApp BOT Yassmin',
  nodes: [...bot.nodes, ...reorderedPaymentNodes],
  connections: { ...bot.connections, ...payConnections },
  pinData: {},
  meta: {
    templateCredsSetupCompleted: true,
    ...(bot.meta?.instanceId ? { instanceId: bot.meta.instanceId } : {})
  }
};

const outPath = path.join(root, 'full-whatsapp-bot-yassmin-workflow.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath, 'nodes:', out.nodes.length);

const cronIdx = out.nodes.findIndex((n) => n.name === 'Cron: Every 30 Minutes');
if (cronIdx >= 0) {
  const payExportNodes = out.nodes.slice(cronIdx);
  const payNames = new Set(payExportNodes.map((n) => n.name));
  const payConnectionsOnly = {};
  for (const k of Object.keys(out.connections)) {
    if (payNames.has(k)) payConnectionsOnly[k] = out.connections[k];
  }
  const payPath = path.join(root, 'whatsapp-payment-confirmation-workflow.json');
  fs.writeFileSync(
    payPath,
    JSON.stringify(
      {
        nodes: payExportNodes,
        connections: payConnectionsOnly,
        pinData: {},
        meta: payment.meta || { templateCredsSetupCompleted: true }
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('Synced', payPath, 'payment nodes:', payExportNodes.length);
}
