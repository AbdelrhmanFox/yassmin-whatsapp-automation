/**
 * Adds paused_chats gate + bot_outbound logging to payment workflow JSON
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PAY_PATH = path.join(root, 'whatsapp-payment-confirmation-workflow.json');

const MAIN_SPREADSHEET_ID = '1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY';
const SHEETS_CRED = {
  googleSheetsOAuth2Api: { id: 'HL2oexu75XGQWtzz', name: 'Google Sheets account' }
};

const EXTRACT_PAYMENT_OUTBOUND = `const resp = $input.first().json;
const row = $('Code: Filter Eligible Rows').item.json;
const messageId =
  resp?.key?.id ||
  resp?.message?.key?.id ||
  resp?.data?.key?.id ||
  resp?.messages?.[0]?.key?.id ||
  '';
const phone = String(row.phone || '').replace(/\\D/g, '');
if (!messageId) {
  return [{ json: { skip: true, reason: 'no_outbound_message_id' } }];
}
return [{
  json: {
    message_id: messageId,
    phone,
    source: 'payment_confirmation',
    sent_at: new Date().toISOString(),
    skip: false
  }
}];`;

function id() {
  return randomUUID();
}

function schemaCol(id) {
  return {
    id,
    displayName: id,
    required: false,
    defaultMatch: false,
    type: 'string',
    display: true
  };
}

const payment = JSON.parse(fs.readFileSync(PAY_PATH, 'utf8'));
if (payment.nodes.some((n) => n.name === 'Sheets: Read Paused Chats (Payment)')) {
  console.log('Payment human handoff already patched — skipping');
  process.exit(0);
}

const cron = payment.nodes.find((n) => n.name === 'Cron: Every 30 Minutes');
const [cx, cy] = cron?.position || [-1728, 912];

const newNodes = [
  {
    parameters: {
      documentId: { __rl: true, value: MAIN_SPREADSHEET_ID, mode: 'id' },
      sheetName: { __rl: true, value: 'paused_chats', mode: 'name' },
      options: { returnAllMatches: true }
    },
    id: id(),
    name: 'Sheets: Read Paused Chats (Payment)',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [cx, cy + 200],
    alwaysOutputData: true,
    settings: { alwaysOutputData: true },
    notesInFlow: true,
    notes: 'Human handoff: skip payment WhatsApp when chat is paused (24h after manual reply).',
    credentials: { ...SHEETS_CRED }
  },
  {
    parameters: { jsCode: EXTRACT_PAYMENT_OUTBOUND },
    id: id(),
    name: 'Code: Extract Payment Outbound Id',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-832, 1040]
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
            id: 'has-pay-outbound',
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
    name: 'IF: Has Payment Outbound Id?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [-608, 1040]
  },
  {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: MAIN_SPREADSHEET_ID, mode: 'id' },
      sheetName: { __rl: true, value: 'bot_outbound', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          message_id: '={{ $json.message_id }}',
          phone: '={{ $json.phone }}',
          source: '={{ $json.source }}',
          sent_at: '={{ $json.sent_at }}'
        },
        matchingColumns: [],
        schema: ['message_id', 'phone', 'source', 'sent_at'].map(schemaCol)
      },
      options: {}
    },
    id: id(),
    name: 'Sheets: Append Payment Bot Outbound',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.4,
    position: [-384, 1040],
    credentials: { ...SHEETS_CRED }
  },
  {
    parameters: {},
    id: id(),
    name: 'No Op: No Payment Outbound Id',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [-608, 1136]
  }
];

payment.nodes.push(...newNodes);

const c = payment.connections;

c['Cron: Every 30 Minutes'].main[0].push({
  node: 'Sheets: Read Paused Chats (Payment)',
  type: 'main',
  index: 0
});

c['IF: Send Success?'].main[0] = [
  { node: 'Code: Extract Payment Outbound Id', type: 'main', index: 0 }
];

c['Code: Extract Payment Outbound Id'] = {
  main: [[{ node: 'IF: Has Payment Outbound Id?', type: 'main', index: 0 }]]
};

c['IF: Has Payment Outbound Id?'] = {
  main: [
    [{ node: 'Sheets: Append Payment Bot Outbound', type: 'main', index: 0 }],
    [{ node: 'No Op: No Payment Outbound Id', type: 'main', index: 0 }]
  ]
};

c['Sheets: Append Payment Bot Outbound'] = {
  main: [[{ node: 'Sheets: Mark Sent', type: 'main', index: 0 }]]
};

c['No Op: No Payment Outbound Id'] = {
  main: [[{ node: 'Sheets: Mark Sent', type: 'main', index: 0 }]]
};

fs.writeFileSync(PAY_PATH, JSON.stringify(payment, null, 2), 'utf8');
console.log('Patched', PAY_PATH, '— added', newNodes.length, 'payment handoff nodes');
