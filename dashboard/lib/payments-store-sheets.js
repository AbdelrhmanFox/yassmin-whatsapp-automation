const { getSheetsApi } = require('./google-sheets');

const PAYMENT_SPREADSHEET_ID =
  process.env.PAYMENT_SPREADSHEET_ID || '1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w';
const PAYMENT_SHEET = process.env.PAYMENT_SHEET_NAME || 'عمليات الدفع';
const MATCH_COL = process.env.PAYMENT_MATCH_COLUMN || 'طابع زمني';

const WHATSAPP_HINT = /واتس|whatsapp|phone|رقم|موبايل|جوال/i;

function norm(s) {
  return String(s ?? '').trim();
}

function normKey(s) {
  return norm(s).toLowerCase();
}

function isDoneValue(v) {
  const s = norm(v).toLowerCase();
  return ['true', 'tru', '1', 'yes', 'done'].includes(s);
}

function findHeaderIndex(headers, matchers) {
  for (let i = 0; i < headers.length; i++) {
    const h = normKey(headers[i]);
    if (matchers.some((m) => (typeof m === 'string' ? h === m.toLowerCase() : m.test(headers[i])))) {
      return i;
    }
  }
  return -1;
}

function findDoneColumnIndex(headers) {
  return findHeaderIndex(headers, ['done']);
}

function findMatchColumnIndex(headers) {
  const exact = headers.findIndex((h) => norm(h) === MATCH_COL);
  if (exact >= 0) return exact;
  return findHeaderIndex(headers, [normKey(MATCH_COL)]);
}

function pickWhatsappFromRow(row, headers) {
  const exactTry = [
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله',
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله2'
  ];
  for (const ek of exactTry) {
    const idx = headers.findIndex((h) => norm(h) === ek);
    if (idx >= 0 && norm(row[idx])) return norm(row[idx]);
  }
  for (let i = 0; i < headers.length; i++) {
    if (WHATSAPP_HINT.test(headers[i]) && /\d/.test(String(row[i] || ''))) {
      return norm(row[i]);
    }
  }
  return '';
}

function rowToObject(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const key = norm(headers[i]);
    if (key) obj[key] = row[i] ?? '';
  }
  return obj;
}

function deriveStatus(rowObj) {
  const done = isDoneValue(rowObj.done ?? rowObj.Done ?? rowObj.DONE);
  const wa = norm(rowObj.whatsapp_status).toLowerCase();
  const dead = norm(rowObj.dead_letter).toLowerCase() === 'true' || wa === 'dead_letter';

  if (dead) return 'dead_letter';
  if (wa === 'sent') return 'sent';
  if (wa === 'failed') return 'failed';
  if (done && !wa) return 'awaiting_whatsapp';
  if (done) return 'confirmed';
  return 'pending_review';
}

async function readPaymentSheet() {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: `'${PAYMENT_SHEET}'!A:ZZ`
  });
  const values = res.data.values || [];
  if (!values.length) {
    return { headers: [], rows: [], sheetTitle: PAYMENT_SHEET };
  }
  const headers = values[0].map((h) => norm(h));
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const line = values[r] || [];
    if (!line.some((c) => norm(c))) continue;
    const obj = rowToObject(headers, line);
    const matchValue = obj[MATCH_COL] ?? obj[normKey(MATCH_COL)] ?? line[findMatchColumnIndex(headers)] ?? '';
    if (!norm(matchValue)) continue;

    const doneRaw = obj.done ?? obj.Done ?? obj.DONE ?? '';
    rows.push({
      id: norm(matchValue),
      rowNumber: r + 1,
      timestamp: norm(matchValue),
      name: norm(obj['الاسم'] ?? obj['الاسم '] ?? ''),
      email: norm(obj['البريد الالكتروني'] ?? ''),
      phone: pickWhatsappFromRow(line, headers),
      product_code: norm(obj.product_code ?? ''),
      product_label:
        norm(obj['محتاج اي '] ?? obj['محتاج اي'] ?? obj['محتاج أي'] ?? '') ||
        norm(obj.product_code ?? ''),
      payment_method: norm(obj['طرق الدفع'] ?? ''),
      done: isDoneValue(doneRaw),
      done_raw: doneRaw,
      whatsapp_status: norm(obj.whatsapp_status),
      whatsapp_last_error: norm(obj.whatsapp_last_error),
      whatsapp_sent_at: norm(obj.whatsapp_sent_at),
      retry_count: norm(obj.retry_count),
      dead_letter: norm(obj.dead_letter).toLowerCase() === 'true',
      status: '',
      raw: obj
    });
  }
  for (const row of rows) {
    row.status = deriveStatus(row.raw);
  }
  return { headers, rows, sheetTitle: PAYMENT_SHEET, spreadsheetId: PAYMENT_SPREADSHEET_ID };
}

function summarize(rows) {
  const stats = {
    total: rows.length,
    pending_review: 0,
    awaiting_whatsapp: 0,
    sent: 0,
    failed: 0,
    dead_letter: 0,
    confirmed_other: 0
  };
  for (const row of rows) {
    if (row.status === 'pending_review') stats.pending_review += 1;
    else if (row.status === 'awaiting_whatsapp') stats.awaiting_whatsapp += 1;
    else if (row.status === 'sent') stats.sent += 1;
    else if (row.status === 'failed') stats.failed += 1;
    else if (row.status === 'dead_letter') stats.dead_letter += 1;
    else stats.confirmed_other += 1;
  }
  return stats;
}

function filterRows(rows, { q = '', status = 'all' }) {
  const query = norm(q).toLowerCase();
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    if (!query) return true;
    const hay = [
      row.timestamp,
      row.name,
      row.email,
      row.phone,
      row.product_code,
      row.product_label,
      row.whatsapp_status,
      row.whatsapp_last_error
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(query);
  });
}

async function listPayments(filters = {}) {
  const { rows, sheetTitle, spreadsheetId } = await readPaymentSheet();
  const filtered = filterRows(rows, filters);
  return {
    ok: true,
    provider: 'sheets',
    sheet: sheetTitle,
    spreadsheetId,
    stats: summarize(rows),
    count: filtered.length,
    rows: filtered
  };
}

async function updatePaymentDone(timestamp, done, options = {}) {
  const sheets = await getSheetsApi();
  const { rows } = await readPaymentSheet();
  const target = rows.find((r) => r.id === norm(timestamp));
  if (!target) {
    const err = new Error('payment_row_not_found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const headerRow = await sheets.spreadsheets.values.get({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: `'${PAYMENT_SHEET}'!1:1`
  });
  const headerCells = (headerRow.data.values?.[0] || []).map((h) => norm(h));
  const doneIdx = findDoneColumnIndex(headerCells);
  if (doneIdx < 0) {
    const err = new Error('done_column_not_found');
    err.code = 'SCHEMA';
    throw err;
  }

  const doneColLetter = columnToLetter(doneIdx + 1);
  const doneValue = done ? 'TRUE' : '';
  await sheets.spreadsheets.values.update({
    spreadsheetId: PAYMENT_SPREADSHEET_ID,
    range: `'${PAYMENT_SHEET}'!${doneColLetter}${target.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[doneValue]] }
  });

  const updates = [];
  const waStatusIdx = headerCells.findIndex((h) => normKey(h) === 'whatsapp_status');
  const waErrorIdx = headerCells.findIndex((h) => normKey(h) === 'whatsapp_last_error');
  const waSentIdx = headerCells.findIndex((h) => normKey(h) === 'whatsapp_sent_at');

  if (!done && options.resetWhatsapp !== false) {
    if (waStatusIdx >= 0) {
      updates.push({
        range: `'${PAYMENT_SHEET}'!${columnToLetter(waStatusIdx + 1)}${target.rowNumber}`,
        values: [['']]
      });
    }
    if (waErrorIdx >= 0) {
      updates.push({
        range: `'${PAYMENT_SHEET}'!${columnToLetter(waErrorIdx + 1)}${target.rowNumber}`,
        values: [['']]
      });
    }
    if (waSentIdx >= 0) {
      updates.push({
        range: `'${PAYMENT_SHEET}'!${columnToLetter(waSentIdx + 1)}${target.rowNumber}`,
        values: [['']]
      });
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: PAYMENT_SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
    });
  }

  return listPayments();
}

function columnToLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

module.exports = {
  listPayments,
  updatePaymentDone,
  readPaymentSheet,
  summarize,
  PAYMENT_SPREADSHEET_ID,
  PAYMENT_SHEET,
  MATCH_COL
};
