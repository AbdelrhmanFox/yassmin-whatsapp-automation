/**
 * ينقل عمليات الدفع من تصدير CSV عام للشيت → Supabase (بدون Google OAuth)
 * يشغّل: node scripts/migrate-csv-to-supabase.mjs
 * يكتب: scripts/.migration-payload.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '.payment-export.csv');
const OUT_PATH = path.join(__dirname, '.migration-payload.json');

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w/gviz/tq?tqx=out:csv&sheet=' +
  encodeURIComponent('عمليات الدفع');

function norm(s) {
  return String(s ?? '').trim();
}

function isDoneValue(v) {
  const s = norm(v).toLowerCase();
  return ['true', 'tru', '1', 'yes', 'done'].includes(s);
}

/** CSV parser for quoted fields */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => norm(x))) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((x) => norm(x))) rows.push(row);
  }
  return rows;
}

function pickPhone(headers, cells) {
  const exact = [
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله',
    'يرجي كتابه رقم الواتس اب الي تم التواصل من خلاله2'
  ];
  for (const ek of exact) {
    const i = headers.findIndex((h) => norm(h) === ek);
    if (i >= 0 && norm(cells[i])) return norm(cells[i]);
  }
  const hint = /واتس|whatsapp|phone|رقم|موبايل|جوال/i;
  for (let i = 0; i < headers.length; i++) {
    if (hint.test(headers[i]) && /\d/.test(cells[i] || '')) return norm(cells[i]);
  }
  return '';
}

function rowToObject(headers, cells) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const k = norm(headers[i]);
    if (k) obj[k] = cells[i] ?? '';
  }
  return obj;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.log('Downloading CSV from Google Sheets...');
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`csv_download_failed_${res.status}`);
    fs.writeFileSync(CSV_PATH, await res.text(), 'utf8');
  }

  const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  if (!table.length) throw new Error('empty_csv');

  const headers = table[0].map((h) => norm(h));
  const tsIdx = headers.findIndex((h) => h === 'طابع زمني' || h.includes('طابع'));
  const payloads = [];

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (!cells.some((c) => norm(c))) continue;
    const obj = rowToObject(headers, cells);
    const form_timestamp =
      tsIdx >= 0 ? norm(cells[tsIdx]) : norm(obj['طابع زمني']) || norm(obj['طابع زمني ']);
    if (!form_timestamp) continue;

    const doneRaw = obj.done ?? obj.Done ?? obj.DONE ?? '';
    payloads.push({
      form_timestamp,
      name: norm(obj['الاسم'] ?? obj['الاسم '] ?? ''),
      email: norm(obj['البريد الالكتروني'] ?? ''),
      phone: pickPhone(headers, cells),
      product_code: norm(obj.product_code ?? ''),
      product_label: norm(obj['محتاج اي '] ?? obj['محتاج اي'] ?? obj['محتاج أي'] ?? ''),
      payment_method: norm(obj['طرق الدفع'] ?? ''),
      done: isDoneValue(doneRaw),
      whatsapp_status: norm(obj.whatsapp_status) || null,
      whatsapp_last_error: norm(obj.whatsapp_last_error) || null,
      whatsapp_sent_at: norm(obj.whatsapp_sent_at) || null,
      retry_count: Number(obj.retry_count) || 0,
      dead_letter: norm(obj.dead_letter).toLowerCase() === 'true',
      raw: obj
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(payloads, null, 2), 'utf8');
  console.log(`Prepared ${payloads.length} rows → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
