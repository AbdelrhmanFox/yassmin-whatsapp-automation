/**
 * ينقل صفوف عمليات الدفع من Google Sheets → Supabase (schema: yassmin)
 *
 * المتطلبات في .env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (+ google-tokens.json)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * تشغيل:
 *   node scripts/migrate-sheets-to-supabase.mjs
 */
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { loadEnvFile } = require('./load-env.js');

loadEnvFile();

const sheetsStore = require('../dashboard/lib/payments-store-sheets.js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const schema = process.env.SUPABASE_SCHEMA || 'yassmin';

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema }
});

function norm(s) {
  return String(s ?? '').trim();
}

async function main() {
  console.log('Reading payments from Google Sheets...');
  const { rows } = await sheetsStore.readPaymentSheet();
  console.log(`Found ${rows.length} rows`);

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const form_timestamp = norm(row.timestamp);
    if (!form_timestamp) {
      skipped += 1;
      continue;
    }

    const payload = {
      form_timestamp,
      name: row.name || null,
      email: row.email || null,
      phone: row.phone || null,
      product_code: row.product_code || null,
      product_label: row.product_label || null,
      payment_method: row.payment_method || null,
      done: Boolean(row.done),
      whatsapp_status: row.whatsapp_status || null,
      whatsapp_last_error: row.whatsapp_last_error || null,
      whatsapp_sent_at: row.whatsapp_sent_at || null,
      retry_count: Number(row.retry_count) || 0,
      dead_letter: Boolean(row.dead_letter),
      raw: row.raw || {}
    };

    const { error } = await supabase.from('payments').upsert(payload, {
      onConflict: 'form_timestamp'
    });

    if (error) {
      console.error('Failed:', form_timestamp, error.message);
    } else {
      upserted += 1;
    }
  }

  console.log(`Done. upserted=${upserted} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
