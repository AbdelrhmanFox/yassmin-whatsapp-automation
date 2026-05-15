/**
 * Adds human-handoff (per-chat pause) nodes to whatsapp-bot-n8n-workflow.json
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const BOT_PATH = path.join(root, 'whatsapp-bot-n8n-workflow.json');

const SPREADSHEET_ID = '1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY';
const SHEETS_CRED = {
  googleSheetsOAuth2Api: { id: 'HL2oexu75XGQWtzz', name: 'Google Sheets account' }
};

const PHONE_EXTRACT_EXPR =
  "={{ (() => { const d = ($json.body?.data ?? $json.data) || {}; const src = [d.sender, d.remoteJidAlt, d.key?.remoteJidAlt, d.key?.remoteJid].find(v => typeof v === 'string' && v.includes('@s.whatsapp.net')) || [d.sender, d.remoteJidAlt, d.key?.remoteJidAlt, d.key?.remoteJid].find(v => typeof v === 'string' && v.length) || ''; return src.replace('@s.whatsapp.net', '').replace(/\\D/g, ''); })() }}";

const MSG_ID_EXPR = '={{ ($json.body?.data ?? $json.data).key.id }}';

const IS_BOT_OWN_CODE = `function normalizePhone(v) {
  let d = String(v ?? '').replace(/\\D/g, '');
  if (!d) return '';
  while (d.startsWith('0020') && d.length > 12) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

const src = $('Set: Extract Outgoing Fields').first().json;
const webhook = $('Webhook: Receive WA Message').first().json;
const d = (webhook.body?.data ?? webhook.data) || {};
const messageId = String(d.key?.id || src.message_id || '');
const phone = normalizePhone(src.phone);
const outboundRows = $input.all().map((i) => i.json).filter((r) => r.message_id);

if (messageId && outboundRows.some((r) => String(r.message_id) === messageId)) {
  return [{ json: { is_bot_message: true, skip_reason: 'bot_outbound_id', phone, message_id: messageId } }];
}

const now = Date.now();
const recentBot = outboundRows.some((r) => {
  if (normalizePhone(r.phone) !== phone) return false;
  const t = new Date(r.sent_at).getTime();
  return Number.isFinite(t) && now - t < 90000;
});
if (recentBot) {
  return [{ json: { is_bot_message: true, skip_reason: 'recent_bot_send', phone, message_id: messageId } }];
}

return [{ json: { is_bot_message: false, phone, message_id: messageId } }];`;

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

const existingRows = $('Sheets: Read Paused Chats Handoff').all().map((i) => i.json);
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

const CHECK_PAUSED_CODE = `function normalizePhone(v) {
  let d = String(v ?? '').replace(/\\D/g, '');
  if (!d) return '';
  while (d.startsWith('0020') && d.length > 12) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '20' + d.slice(1);
  if (!d.startsWith('20') && d.length === 10) return '20' + d;
  return d;
}

const source = $('Set: Extract Fields').first().json;
const phone = normalizePhone(source.phone);
const pausedRows = $input.all().map((i) => i.json);

let chat_paused = false;
for (const r of pausedRows) {
  if (normalizePhone(r.phone) !== phone) continue;
  const active = String(r.active ?? '').trim().toUpperCase() === 'TRUE';
  if (!active) continue;
  const exp = new Date(r.expires_at).getTime();
  if (Number.isFinite(exp) && exp > Date.now()) {
    chat_paused = true;
    break;
  }
}

return [{ json: { ...source, chat_paused } }];`;

const EXTRACT_OUTBOUND_CODE = `const resp = $input.first().json;
const km = $('Code: Keyword Matcher').first().json;
const messageId =
  resp?.key?.id ||
  resp?.message?.key?.id ||
  resp?.data?.key?.id ||
  resp?.messages?.[0]?.key?.id ||
  '';
const phone = String(km.phone || '').replace(/\\D/g, '');
if (!messageId) {
  return [{ json: { skip: true, reason: 'no_outbound_message_id' } }];
}
return [{
  json: {
    message_id: messageId,
    phone,
    source: 'keyword_reply',
    sent_at: new Date().toISOString(),
    skip: false
  }
}];`;

function id() {
  return randomUUID();
}

function sheetsRead(name, sheet, y, x = -5200) {
  return {
    parameters: {
      documentId: { __rl: true, value: SPREADSHEET_ID, mode: 'id' },
      sheetName: { __rl: true, value: sheet, mode: 'name' },
      options: { returnAllMatches: true }
    },
    id: id(),
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [x, y],
    alwaysOutputData: true,
    settings: { alwaysOutputData: true },
    credentials: { ...SHEETS_CRED }
  };
}

function schemaCol(id) {
  return {
    id,
    displayName: id,
    required: false,
    defaultMatch: id === 'phone',
    type: 'string',
    display: true
  };
}

function sheetsAppendOrUpdate(name, sheet, columns, y, x = -4752) {
  return {
    parameters: {
      operation: 'appendOrUpdate',
      documentId: { __rl: true, value: SPREADSHEET_ID, mode: 'id' },
      sheetName: { __rl: true, value: sheet, mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: columns,
        matchingColumns: ['phone'],
        schema: Object.keys(columns).map((k) => schemaCol(k))
      },
      options: {}
    },
    id: id(),
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [x, y],
    credentials: { ...SHEETS_CRED }
  };
}

function sheetsAppend(name, sheet, columns, y, x = -3856) {
  return {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SPREADSHEET_ID, mode: 'id' },
      sheetName: { __rl: true, value: sheet, mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: columns,
        matchingColumns: [],
        schema: Object.keys(columns).map((k) => schemaCol(k))
      },
      options: {}
    },
    id: id(),
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [x, y],
    credentials: { ...SHEETS_CRED }
  };
}

const bot = JSON.parse(fs.readFileSync(BOT_PATH, 'utf8'));
const names = new Set(bot.nodes.map((n) => n.name));
if (names.has('IF: Outgoing Message?')) {
  console.log('Human handoff already patched on bot workflow — skipping');
  process.exit(0);
}

const webhook = bot.nodes.find((n) => n.name === 'Webhook: Receive WA Message');
const setExtract = bot.nodes.find((n) => n.name === 'Set: Extract Fields');
const [wx, wy] = webhook?.position || [-6320, 1616];
const [sx, sy] = setExtract?.position || [-5648, 1520];

const newNodes = [
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2
        },
        conditions: [
          {
            id: 'out-from-me',
            leftValue: '={{ ($json.body?.data ?? $json.data).key.fromMe }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          },
          {
            id: 'out-not-group',
            leftValue: '={{ ($json.body?.data ?? $json.data).key.remoteJid }}',
            rightValue: '@g.us',
            operator: { type: 'string', operation: 'notContains' }
          },
          {
            id: 'out-recent',
            leftValue: '={{ (Date.now() / 1000) - ($json.body?.data ?? $json.data).messageTimestamp }}',
            rightValue: 300,
            operator: { type: 'number', operation: 'lt' }
          }
        ],
        combinator: 'and'
      },
      options: {}
    },
    id: id(),
    name: 'IF: Outgoing Message?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    notesInFlow: true,
    position: [wx, wy + 400],
    notes: 'Human handoff: detects manual replies sent from WhatsApp (fromMe=true).'
  },
  {
    parameters: {
      assignments: {
        assignments: [
          { id: 'o1', name: 'phone', value: PHONE_EXTRACT_EXPR, type: 'string' },
          { id: 'o2', name: 'message_id', value: MSG_ID_EXPR, type: 'string' }
        ]
      },
      options: {}
    },
    id: id(),
    name: 'Set: Extract Outgoing Fields',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [wx + 224, wy + 400]
  },
  sheetsRead('Sheets: Read Bot Outbound', 'bot_outbound', wy + 400, wx + 448),
  {
    parameters: { jsCode: IS_BOT_OWN_CODE },
    id: id(),
    name: 'Code: Is Bot Own Message?',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [wx + 672, wy + 400]
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2
        },
        conditions: [
          {
            id: 'is-human',
            leftValue: '={{ $json.is_bot_message }}',
            rightValue: false,
            operator: { type: 'boolean', operation: 'equals' }
          }
        ],
        combinator: 'and'
      },
      options: {}
    },
    id: id(),
    name: 'IF: Human Sent?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [wx + 896, wy + 400]
  },
  sheetsRead('Sheets: Read Paused Chats Handoff', 'paused_chats', wy + 520, wx + 1120),
  {
    parameters: { jsCode: BUILD_PAUSE_CODE },
    id: id(),
    name: 'Code: Build Pause Row',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [wx + 1120, wy + 400]
  },
  sheetsAppendOrUpdate('Sheets: Upsert Paused Chat', 'paused_chats', {
    phone: '={{ $json.phone }}',
    paused_at: '={{ $json.paused_at }}',
    last_human_at: '={{ $json.last_human_at }}',
    expires_at: '={{ $json.expires_at }}',
    reason: '={{ $json.reason }}',
    active: '={{ $json.active }}'
  }, wy + 400, wx + 1344),
  {
    parameters: {},
    id: id(),
    name: 'No Op: Skip Bot Outgoing',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [wx + 896, wy + 520]
  },
  sheetsRead('Sheets: Read Paused Chats Gate', 'paused_chats', sy, sx + 224),
  {
    parameters: { jsCode: CHECK_PAUSED_CODE },
    id: id(),
    name: 'Code: Check Chat Paused',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [sx + 448, sy]
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2
        },
        conditions: [
          {
            id: 'chat-paused',
            leftValue: '={{ $json.chat_paused }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }
        ],
        combinator: 'and'
      },
      options: {}
    },
    id: id(),
    name: 'IF: Chat Paused?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    notesInFlow: true,
    position: [sx + 672, sy],
    notes: 'Stops bot + leads when chat is in human handoff (24h from last manual reply).'
  },
  {
    parameters: {},
    id: id(),
    name: 'No Op: Human Handoff',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [sx + 896, sy + 96]
  },
  {
    parameters: { jsCode: EXTRACT_OUTBOUND_CODE },
    id: id(),
    name: 'Code: Extract Outbound Id',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-4080, 2000]
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2
        },
        conditions: [
          {
            id: 'has-outbound-id',
            leftValue: '={{ $json.skip }}',
            rightValue: false,
            operator: { type: 'boolean', operation: 'equals' }
          }
        ],
        combinator: 'and'
      },
      options: {}
    },
    id: id(),
    name: 'IF: Has Outbound Id?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [-3856, 2000]
  },
  sheetsAppend('Sheets: Append Bot Outbound', 'bot_outbound', {
    message_id: '={{ $json.message_id }}',
    phone: '={{ $json.phone }}',
    source: '={{ $json.source }}',
    sent_at: '={{ $json.sent_at }}'
  }, 2000, -3632),
  {
    parameters: {},
    id: id(),
    name: 'No Op: No Outbound Id',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [-3856, 2096]
  }
];

bot.nodes.push(...newNodes);

const c = bot.connections;

c['Webhook: Receive WA Message'].main[0].push({
  node: 'IF: Outgoing Message?',
  type: 'main',
  index: 0
});

c['IF: Outgoing Message?'] = {
  main: [
    [{ node: 'Set: Extract Outgoing Fields', type: 'main', index: 0 }],
    [{ node: 'No Op: Skip Bot Outgoing', type: 'main', index: 0 }]
  ]
};

c['Set: Extract Outgoing Fields'] = {
  main: [[{ node: 'Sheets: Read Bot Outbound', type: 'main', index: 0 }]]
};

c['Sheets: Read Bot Outbound'] = {
  main: [[{ node: 'Code: Is Bot Own Message?', type: 'main', index: 0 }]]
};

c['Code: Is Bot Own Message?'] = {
  main: [[{ node: 'IF: Human Sent?', type: 'main', index: 0 }]]
};

c['IF: Human Sent?'] = {
  main: [
    [{ node: 'Sheets: Read Paused Chats Handoff', type: 'main', index: 0 }],
    [{ node: 'No Op: Skip Bot Outgoing', type: 'main', index: 0 }]
  ]
};

c['Sheets: Read Paused Chats Handoff'] = {
  main: [[{ node: 'Code: Build Pause Row', type: 'main', index: 0 }]]
};

c['Code: Build Pause Row'] = {
  main: [[{ node: 'Sheets: Upsert Paused Chat', type: 'main', index: 0 }]]
};

c['Set: Extract Fields'].main[0] = [
  { node: 'Sheets: Read Paused Chats Gate', type: 'main', index: 0 }
];

c['Sheets: Read Paused Chats Gate'] = {
  main: [[{ node: 'Code: Check Chat Paused', type: 'main', index: 0 }]]
};

c['Code: Check Chat Paused'] = {
  main: [[{ node: 'IF: Chat Paused?', type: 'main', index: 0 }]]
};

c['IF: Chat Paused?'] = {
  main: [
    [{ node: 'No Op: Human Handoff', type: 'main', index: 0 }],
    [
      { node: 'Sheets: Read Keywords', type: 'main', index: 0 },
      { node: 'Code: Email Extract & Classify', type: 'main', index: 0 }
    ]
  ]
};

c['HTTP: Send Reply'].main[0] = [
  { node: 'Code: Extract Outbound Id', type: 'main', index: 0 }
];

c['Code: Extract Outbound Id'] = {
  main: [[{ node: 'IF: Has Outbound Id?', type: 'main', index: 0 }]]
};

c['IF: Has Outbound Id?'] = {
  main: [
    [{ node: 'Sheets: Append Bot Outbound', type: 'main', index: 0 }],
    [{ node: 'No Op: No Outbound Id', type: 'main', index: 0 }]
  ]
};

c['Sheets: Append Bot Outbound'] = {
  main: [[{ node: 'Sheets: Append Log', type: 'main', index: 0 }]]
};

c['No Op: No Outbound Id'] = {
  main: [[{ node: 'Sheets: Append Log', type: 'main', index: 0 }]]
};

fs.writeFileSync(BOT_PATH, JSON.stringify(bot, null, 2), 'utf8');
console.log('Patched', BOT_PATH, '— added', newNodes.length, 'human-handoff nodes');
