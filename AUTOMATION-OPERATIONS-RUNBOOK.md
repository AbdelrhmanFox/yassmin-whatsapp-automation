# Automation Operations Runbook

This runbook covers validation, rollout, and emergency controls for the upgraded automation.

## 1) Validation Suite

Run the following scenarios before production rollout:

1. Happy path
   - Row has `Done=TRUE`, valid `phone`, **`product_code`** matching a row in tab **`product_pdf_map`** (Evolution instance fixed in n8n: **Yas**).
   - Expected: WhatsApp text includes confirmation + PDF URL; `whatsapp_status=sent`, `retry_count=0`, `dead_letter=false`.

2. Evolution timeout / transient API failure
   - Simulate timeout or temporary 5xx.
   - Expected: `whatsapp_status=failed`, `retry_count` increments, `next_retry_at` populated.

3. Invalid phone
   - Use invalid number format.
   - Expected: row blocked before send with `error_code=invalid_phone_format_expected_20XXXXXXXXXX`.

4. Max retries reached
   - Force repeated failures until retry threshold.
   - Expected: `whatsapp_status=dead_letter`, `dead_letter=true`, `next_retry_at=''`.

5. Lock collision
   - Two workers attempt same row.
   - Expected: second worker gets precheck block `locked_by_other_worker`.

## 2) Rollout Strategy

1. Stage 0 (dry-run)
   - Import workflow to staging n8n.
   - Verify sheet columns exist and expressions evaluate correctly.

2. Stage 1 (10% of rows)
   - Process only a filtered subset (for example one region or one instance).
   - Track failure ratio and latency.

3. Stage 2 (50%)
   - Expand filter.
   - Keep manual on-call monitoring for 24h.

4. Stage 3 (100%)
   - Remove subset filter.
   - Keep dead-letter monitoring active.

## 3) Kill Switch

Primary kill switch options:

- Pause workflow in n8n UI (immediate stop of scheduled runs).
- Use control webhook action `pause` from dashboard.
- Revoke Evolution API key if emergency containment needed.

Resume checklist:

1. Root cause fixed.
2. `pause` state removed.
3. Retry only non-dead-letter rows first.
4. Re-enable full schedule.

## 4) Required Columns (Payment Rows)

Ensure these columns exist in the source sheet used by payment workflow:

- `retry_count`
- `max_retries`
- `next_retry_at`
- `locked_at`
- `lock_owner`
- `dead_letter`
- `last_http_status`
- `event_type`
- `stage`
- `result`
- `error_code`
- `latency_ms`

## 4b) Done confirmation + PDF by product (FULL WhatsApp workflow)

Payment spreadsheet **`1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w`**:

- Tab **`عمليات الدفع`**: Google Form must include a question titled exactly **`product_code`** (dropdown values = slugs in the map tab, e.g. `voltaren_social`, `inner_compass`). Plus **Done**, `whatsapp_*` columns as before.
- Tab **`product_pdf_map`**: columns **`product_code`**, **`pdf_url`**, optional **`label_ar`**. Each `product_code` must match a Form option. Edit URLs here without changing n8n.
- Cron runs **Sheets: Read Payment Rows** and **Sheets: Read Product PDF Map** in parallel → **Merge (append)** → **Code: Filter Eligible Rows** splits merged items into payment rows (have **`طابع زمني`**) vs map rows (have `pdf_url`, no timestamp column). Message = confirmation + PDF link, or confirmation + “no PDF found” line if code missing in map.
- Code node does **not** read `$env` or `process` (avoids task-runner env restrictions).
- Evolution instance for payment sends is fixed **`Yas`** in `scripts/build-full-whatsapp-workflow.mjs` (URL + Code); sheet column `instance` on payment rows is ignored for routing.
- Columns updated on success/fail: `whatsapp_status`, `whatsapp_last_error`, `whatsapp_sent_at`; match on **`طابع زمني`**.

**Operational note:** Import **`full-whatsapp-bot-yassmin-workflow.json`** only in production. Only one active workflow should own the webhook + payment cron (do not also activate split `whatsapp-bot…` / `whatsapp-payment…` imports).

## 5) Environment Variables

- **Evolution `apikey` (payment path):** stored as a **plain header value** on `HTTP: Send Payment Confirmation`, copied from bot node `HTTP: Send Reply` when you run `npm run build:full-workflow` (avoids n8n “access to env vars denied” on `$env` in expressions). Rotate the key in **both** HTTP nodes or only in the bot JSON, then rebuild.

Simplified payment **Code** node uses fixed lock/retry numbers (no `PAYMENT_*` env reads).

- `DASHBOARD_PORT` (optional, default `8088`)
- `DASHBOARD_ADMIN_TOKEN` (required for dashboard control)
- `CONTROL_WEBHOOK_URL` (required for dashboard control API)
