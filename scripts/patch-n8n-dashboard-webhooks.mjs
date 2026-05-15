/**
 * n8n → Supabase (مصدر الحقيقة للوحة + بوابة الإيقاف المؤقت)
 * - كتابة message_log و paused_chats عبر Edge Function (متوازي مع الشيتات كنسخة احتياطية)
 * - قراءة paused_chats من DB بدل Google Sheets في مسار الاستقبال
 *
 * يتطلب في n8n: متغير بيئة SUPABASE_ANON_KEY
 * ونشر: supabase functions deploy yassmin-dashboard-api
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SUPABASE_PROJECT = process.env.SUPABASE_PROJECT_REF || 'elcofahsbznfalrbjmfo';
const EDGE_BASE =
  process.env.SUPABASE_DASHBOARD_FUNCTION_URL ||
  `https://${SUPABASE_PROJECT}.supabase.co/functions/v1/yassmin-dashboard-api`;

const ANON_HEADER = '={{ $env.SUPABASE_ANON_KEY }}';
const AUTH_HEADER = "={{ 'Bearer ' + $env.SUPABASE_ANON_KEY }}";

const MSG_BODY = `={{ JSON.stringify({
  phone: $('Code: Keyword Matcher').first().json.phone,
  message: $('Code: Keyword Matcher').first().json.message_text,
  keyword_matched: $('Code: Keyword Matcher').first().json.keyword_matched,
  reply_sent: $('Code: Keyword Matcher').first().json.reply,
  status: $('Code: Keyword Matcher').first().json.reply ? 'auto_replied' : 'received',
  message_id: $('Code: Keyword Matcher').first().json.message_id,
  timestamp: $('Code: Keyword Matcher').first().json.received_at
}) }}`;

const MSG_INBOUND_ONLY = `={{ JSON.stringify({
  phone: $('Code: Keyword Matcher').first().json.phone,
  message: $('Code: Keyword Matcher').first().json.message_text,
  keyword_matched: $('Code: Keyword Matcher').first().json.keyword_matched || null,
  reply_sent: null,
  status: 'received',
  message_id: $('Code: Keyword Matcher').first().json.message_id,
  timestamp: $('Code: Keyword Matcher').first().json.received_at
}) }}`;

const MSG_PAUSED_SKIP = `={{ JSON.stringify({
  phone: $('Set: Extract Fields').first().json.phone,
  message: $('Set: Extract Fields').first().json.message_text,
  status: 'human_handoff_skipped',
  message_id: $('Set: Extract Fields').first().json.message_id,
  timestamp: $('Set: Extract Fields').first().json.received_at || new Date().toISOString()
}) }}`;

const PAUSE_BODY = `={{ JSON.stringify({
  phone: $json.phone,
  paused_at: $json.paused_at,
  last_human_at: $json.last_human_at,
  expires_at: $json.expires_at,
  reason: $json.reason,
  active: String($json.active).toUpperCase() === 'TRUE'
}) }}`;

const FLATTEN_PAUSED_CODE = `const data = $input.first().json || {};
const rows = Array.isArray(data.rows) ? data.rows : [];
if (!rows.length) {
  return [{ json: { phone: '', active: 'FALSE', expires_at: '', _empty: true } }];
}
return rows.map((r) => ({
  json: {
    ...r,
    active: r.active === true || String(r.active ?? '').trim().toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'
  }
}));`;

const BUILD_PAUSE_CODE = `function normalizePhone(v) {
  let d = String(v ?? '').replace(/\\D/g, '');
  if (!d) return '';
  while (d.startsWith('0020') && d.length > 12) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

const src = $('Set: Extract Outgoing Fields').first().json;
const phone = normalizePhone(src.phone);
const now = new Date();
const nowIso = now.toISOString();
const expiresIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

let existingRows = [];
try {
  const http = $('HTTP: Read Paused Chats Handoff (DB)').first().json;
  if (Array.isArray(http.rows)) existingRows = http.rows;
} catch {}
if (!existingRows.length) {
  try {
    existingRows = $('Sheets: Read Paused Chats Handoff').all().map((i) => i.json);
  } catch {}
}

const existing = existingRows.find((r) => normalizePhone(r.phone) === phone);

return [{
  json: {
    phone,
    paused_at: existing?.paused_at || nowIso,
    last_human_at: nowIso,
    expires_at: expiresIso,
    reason: 'human_handoff',
    active: 'TRUE'
  }
}];`;

function supabaseHeaders() {
  return {
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'apikey', value: ANON_HEADER },
        { name: 'Authorization', value: AUTH_HEADER },
        { name: 'Content-Type', value: 'application/json' }
      ]
    }
  };
}

function httpPost(name, urlPath, bodyExpr, position, notes) {
  return {
    parameters: {
      method: 'POST',
      url: `${EDGE_BASE.replace(/\/$/, '')}${urlPath}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: bodyExpr,
      ...supabaseHeaders(),
      options: { timeout: 20000 }
    },
    id: randomUUID(),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    notesInFlow: true,
    position,
    notes: notes || 'يكتب في Supabase (yassmin) — المصدر الذي تسمعه اللوحة.'
  };
}

function httpGet(name, urlPath, position) {
  return {
    parameters: {
      method: 'GET',
      url: `${EDGE_BASE.replace(/\/$/, '')}${urlPath}`,
      ...supabaseHeaders(),
      options: { timeout: 20000 }
    },
    id: randomUUID(),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    notesInFlow: true,
    position,
    alwaysOutputData: true,
    settings: { alwaysOutputData: true },
    notes: 'يقرأ paused_chats من Supabase.'
  };
}

function codeNode(name, jsCode, position) {
  return {
    parameters: { jsCode },
    id: randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position
  };
}

function upsertNode(nodes, name, factory) {
  const i = nodes.findIndex((n) => n.name === name);
  const node = factory();
  if (i >= 0) {
    node.id = nodes[i].id;
    node.position = nodes[i].position;
    nodes[i] = node;
  } else {
    nodes.push(node);
  }
  return node;
}

function removeNodes(nodes, names) {
  const set = new Set(names);
  return nodes.filter((n) => !set.has(n.name));
}

function patchWorkflow(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const wf = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let nodes = wf.nodes || [];
  const connections = wf.connections || {};

  const appendLog = nodes.find((n) => n.name === 'Sheets: Append Log');
  const sendReply = nodes.find((n) => n.name === 'HTTP: Send Reply');
  const buildPause = nodes.find((n) => n.name === 'Code: Build Pause Row');
  const gateSheet = nodes.find((n) => n.name === 'Sheets: Read Paused Chats Gate');
  if (!appendLog || !sendReply || !buildPause || !gateSheet) {
    console.warn(`Skip ${path.basename(filePath)}: missing core nodes`);
    return false;
  }

  nodes = removeNodes(nodes, ['HTTP: Sync Message Log', 'HTTP: Sync Paused Chat']);

  const gatePos = gateSheet.position || [-5648, 1520];
  const sendPos = sendReply.position || [-4080, 1808];
  const pausePos = buildPause.position || [-5200, 2016];

  upsertNode(nodes, 'HTTP: DB Ingest Message', () =>
    httpPost(
      'HTTP: DB Ingest Message',
      '/ingest/message',
      MSG_BODY,
      [sendPos[0] + 240, sendPos[1] - 120],
      'بعد إرسال الرد — يكتب في Supabase (متوازي مع الشيت).'
    )
  );
  upsertNode(nodes, 'HTTP: DB Ingest Message (No Reply)', () =>
    httpPost(
      'HTTP: DB Ingest Message (No Reply)',
      '/ingest/message',
      MSG_INBOUND_ONLY,
      [sendPos[0] + 240, sendPos[1] + 200],
      'رسالة بدون رود تلقائي.'
    )
  );
  upsertNode(nodes, 'HTTP: DB Ingest Message (Paused)', () =>
    httpPost(
      'HTTP: DB Ingest Message (Paused)',
      '/ingest/message',
      MSG_PAUSED_SKIP,
      [gatePos[0] + 240, gatePos[1] - 120],
      'محادثة موقوفة — تسجيل واردة فقط.'
    )
  );
  upsertNode(nodes, 'HTTP: DB Ingest Paused Chat', () =>
    httpPost(
      'HTTP: DB Ingest Paused Chat',
      '/ingest/paused-chat',
      PAUSE_BODY,
      [pausePos[0] + 280, pausePos[1]],
      'إيقاف الرد التلقائي 24 ساعة في Supabase.'
    )
  );
  upsertNode(nodes, 'HTTP: Read Paused Chats (DB)', () =>
    httpGet('HTTP: Read Paused Chats (DB)', '/paused-chats', [gatePos[0] + 120, gatePos[1]])
  );
  upsertNode(nodes, 'HTTP: Read Paused Chats Handoff (DB)', () =>
    httpGet('HTTP: Read Paused Chats Handoff (DB)', '/paused-chats', [pausePos[0] - 120, pausePos[1]])
  );
  upsertNode(nodes, 'Code: Flatten Paused Rows', () =>
    codeNode('Code: Flatten Paused Rows', FLATTEN_PAUSED_CODE, [gatePos[0] + 240, gatePos[1]])
  );

  const buildPauseNode = nodes.find((n) => n.name === 'Code: Build Pause Row');
  if (buildPauseNode) {
    buildPauseNode.parameters.jsCode = BUILD_PAUSE_CODE;
  }

  // إرسال الرد → استخراج outbound + كتابة DB (متوازي)
  connections['HTTP: Send Reply'] = {
    main: [
      [
        { node: 'Code: Extract Outbound Id', type: 'main', index: 0 },
        { node: 'HTTP: DB Ingest Message', type: 'main', index: 0 }
      ]
    ]
  };

  // لا يوجد رد تلقائي → سجل في DB
  connections['No Op: No Reply'] = {
    main: [[{ node: 'HTTP: DB Ingest Message (No Reply)', type: 'main', index: 0 }]]
  };

  // محادثة موقوفة → سجل واردة
  connections['No Op: Human Handoff'] = {
    main: [[{ node: 'HTTP: DB Ingest Message (Paused)', type: 'main', index: 0 }]]
  };

  // استقبال: قراءة الإيقاف من DB
  connections['Set: Extract Fields'] = {
    main: [[{ node: 'HTTP: Read Paused Chats (DB)', type: 'main', index: 0 }]]
  };
  connections['HTTP: Read Paused Chats (DB)'] = {
    main: [[{ node: 'Code: Flatten Paused Rows', type: 'main', index: 0 }]]
  };
  connections['Code: Flatten Paused Rows'] = {
    main: [[{ node: 'Code: Check Chat Paused', type: 'main', index: 0 }]]
  };
  delete connections['Sheets: Read Paused Chats Gate'];

  // handoff بشري: قراءة + بناء + DB + شيت
  connections['IF: Human Sent?'] = {
    main: [
      [{ node: 'HTTP: Read Paused Chats Handoff (DB)', type: 'main', index: 0 }],
      [{ node: 'No Op: Skip Bot Outgoing', type: 'main', index: 0 }]
    ]
  };
  connections['HTTP: Read Paused Chats Handoff (DB)'] = {
    main: [[{ node: 'Code: Build Pause Row', type: 'main', index: 0 }]]
  };
  connections['Code: Build Pause Row'] = {
    main: [
      [
        { node: 'Sheets: Upsert Paused Chat', type: 'main', index: 0 },
        { node: 'HTTP: DB Ingest Paused Chat', type: 'main', index: 0 }
      ]
    ]
  };

  // الشيتات تبقى للأرشفة فقط — بدون انتظار sync بعدها
  delete connections['Sheets: Append Log'];
  delete connections['Sheets: Upsert Paused Chat'];

  wf.nodes = nodes;
  wf.connections = connections;
  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2), 'utf8');
  return true;
}

const targets = [
  path.join(root, 'whatsapp-bot-n8n-workflow.json'),
  path.join(root, 'full-whatsapp-bot-yassmin-workflow.json')
];

let ok = 0;
for (const t of targets) {
  if (patchWorkflow(t)) {
    console.log('✓ Supabase DB patch:', path.basename(t));
    ok++;
  }
}

if (!ok) {
  console.error('No workflows patched.');
  process.exit(1);
}

console.log('\nNext: set SUPABASE_ANON_KEY in n8n → redeploy edge function → re-import workflow.');
