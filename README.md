# WhatsApp Bot Automation (n8n + Evolution + Google Sheets)

Production-ready WhatsApp auto-reply workflow with keyword matching, anti-ban protections, deduplication, message logging, and email-based lead capture.

## Stack
- `n8n` (workflow engine)
- `Evolution API` (WhatsApp transport)
- `Google Sheets` (keywords + audit logs)

## Files
- **`full-whatsapp-bot-yassmin-workflow.json`** — **ملف الإنتاج الوحيد**: استورديه في n8n فقط. يضم البوت + الكلمات + اللوج + الليدز + كرون تأكيد الدفع وPDF في workflow واحد. يُحدَّث بتشغيل `npm run build:full-workflow`.
- `whatsapp-bot-n8n-workflow.json` — مصدر التطوير (جزء البوت فقط؛ يُدمج بالسكربت أعلاه).
- `whatsapp-payment-confirmation-workflow.json` — **يُولَّد تلقائيًا** من نفس السكربت (نسخة جزء الدفع للمراجعة/المقارنة؛ **لا تستورديه مع الملف الكامل** لتجنب كرون أو Webhook مضاعف).
- `n8n-control-webhooks-workflow.json` - control endpoint template (`pause`, `resume`, `retry_failed`, `update_rules`)
- `MCP-n8n-implementation-guide.md` - MCP setup and PoC rollout guide
- `AUTOMATION-OPERATIONS-RUNBOOK.md` - validation suite, rollout stages, kill switch
- `dashboard/` - lightweight web dashboard MVP (operations + rules + health/log view)
- `register-webhook-final.ps1` - webhook registration helper
- `register-evolution-webhook.ps1` - alternate registration helper

## Google Sheets Structure
Use this spreadsheet:
`https://docs.google.com/spreadsheets/d/1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY`

### `keywords` sheet
Headers:
- `keyword`
- `reply`
- `active`

### `message_log` sheet
Headers:
- `timestamp`
- `phone`
- `message`
- `keyword_matched`
- `reply_sent`
- `status`
- `message_id`

### `email_leads` sheet
Primary key: **`email`**. Created automatically by `setup-google-sheets.js`.

Headers:
| Column | Description |
|---|---|
| `created_at` | ISO timestamp of first message from this email |
| `last_seen_at` | ISO timestamp of most recent message |
| `email` | Normalized email (lowercase, trimmed) — primary key |
| `phone` | WhatsApp phone/JID |
| `name_hint` | Name extracted from message text (if any) |
| `intent_type` | Classified intent (see Intent Types below) |
| `latest_message` | Full text of the most recent message |
| `message_id` | WhatsApp message ID |
| `source` | Always `whatsapp` |
| `status` | `new` (first time) or `updated` (repeat contact) |

#### Intent Types
| Value | Trigger keywords |
|---|---|
| `free_gifts` | هدايا, مجانية, الهدايا |
| `paid_products` | فولتارين, بوصلة, بوصله, 17$, 9$ |
| `planner_order` | بلانر, planner, 399 |
| `full_bundle` | باقة, باقه, انقاذ, شاملة, 1400 |
| `private_consultation` | جلسة, كوتشينج, 50$ |
| `free_consultation` | استشارة, استشاره, butterfly |
| `other` | anything else |

### Payment spreadsheet (عمليات الدفع فقط — بدون قوالب إضافية)

ملف منفصل عن بيانات البوت: إجابات الفورم والدفع.

`https://docs.google.com/spreadsheets/d/1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w`

#### Tab `عمليات الدفع`

- يقرأ الصفوف، يلتقط رقم الواتس من عمود عنوانه فيه **رقم** / **واتس** / **phone**.
- لما **Done** / **done** يتعبّى → يبعت **`تم تأكيد الدفع.`** + **رابط PDF** لو عمود **`product_code`** مطابق لتبويب **`product_pdf_map`** في نفس ملف الشيت.
- تحديث الصف بعد الإرسال يعتمد على عمود **`طابع زمني`** (من الفورم).

| العمود | الغرض |
|--------|--------|
| **`product_code`** | عنوان سؤال في Google Form بنفس الاسم؛ القيم (مثل `voltaren_social`) لازم تطابق عمود **`product_code`** في تبويب **`product_pdf_map`** حيث **`pdf_url`**. |
| `Done` أو `done` | تفعيل إرسال التأكيد |
| `whatsapp_status` | فاضي → يُرسل؛ بعد النجاح `sent`؛ عند الفشل `failed` |
| `whatsapp_last_error` | رسالة خطأ مختصرة |
| `whatsapp_sent_at` | وقت الإرسال |
| `instance` (اختياري) | للتوثيق فقط في الشيت؛ مسار الدفع يستخدم دائمًا مثيل **Yas** الثابت في الـ workflow ([scripts/build-full-whatsapp-workflow.mjs](scripts/build-full-whatsapp-workflow.mjs)) |

ما فيش حاجة لتبويبات `done_reply_templates` أو `intent_done_template_map` في التشغيل الحالي (ممكن تفضليها في الملف من غير ما الـ workflow يقراها).

## Workflow Overview

### Main Reply Path
1. `Webhook: Receive WA Message` — receives Evolution API event
2. `IF: Valid Message?` — filters own messages, old events, groups, empty text
3. `Set: Extract Fields` — extracts phone, message_text, message_id, timestamp
4. `Sheets: Read Keywords` — loads keyword→reply map
5. `Code: Keyword Matcher` — matches keyword, sets `reply`
6. `IF: Has Reply?` — skips unmatched messages
7. `Sheets: Read Full Log` — reads audit log for dedup/rate checks
8. `Code: Dedup & Volume Check` — enforces all anti-ban rules
9. `IF: Clear to Send?` — blocks if any rate limit hit
10. `Wait: Anti-Ban Delay` — random delay (1–4s)
11. `HTTP: Send Reply` — sends via Evolution API
12. `Sheets: Append Log` — writes audit row to `message_log`

### Email Lead Path (runs after every successful reply)
13. `Code: Email Extract & Classify` — extracts email via regex, classifies intent_type
14. `IF: Has Email?` — branches on whether a valid email was found
    - **TRUE path:**
      15. `Sheets: Read Email Leads` — reads all rows from `email_leads`
      16. `Code: Email Upsert Logic` — checks if email exists (upsert decision)
      17. `IF: Email Exists?`
          - TRUE → `Sheets: Update Email Lead` — updates last_seen_at, message, intent, phone
          - FALSE → `Sheets: Append Email Lead` — inserts new lead row
    - **FALSE path:** `No Op: No Email` — silent skip

### Payment / Done confirmation (included in `full-whatsapp-bot-yassmin-workflow.json`)

كل **30 دقيقة**: قراءة **`عمليات الدفع`** + تبويب **`product_pdf_map`** (دمج ثم كود) → تصفية الصفوف اللي فيها **Done** وليس `whatsapp_status=sent` → إرسال **`تم تأكيد الدفع.`** + **رابط PDF** حسب عمود الفورم **`product_code`** (قيم مطابقة لـ `product_code` في `product_pdf_map`) عبر Evolution → تحديث `whatsapp_status` / `whatsapp_last_error` / `whatsapp_sent_at` بمطابقة **`طابع زمني`**. لو الكود غير معروف في الخريطة تُرسل رسالة التأكيد مع تنبيه بدون رابط.

عقدة **Code** في مسار الدفع **لا تستخدم** `$env` ولا `process` (لتجنب أخطاء task runner). عقدة **`HTTP: Send Payment Confirmation`** تستخدم نفس **header `apikey`** الثابت الموجود في عقدة **`HTTP: Send Reply`** (يُنسخ تلقائيًا عند `npm run build:full-workflow`). لا تُستخدم تعبيرات `$env` في مسار الدفع.

لتغيير معرّف الشيت أو اسم التاب أو النص الثابت أو مثيل Evolution (`DEFAULT_EVOLUTION_INSTANCE` و `EVOLUTION_PAYMENT_SEND_BASE`) عدّلي القيم في `scripts/build-full-whatsapp-workflow.mjs` ثم شغّلي `npm run build:full-workflow`.

## Anti-Ban Protections
Implemented in `Code: Dedup & Volume Check`:
- Deduplicate by `message_id`
- Prevent repeated same text from same user within 120s
- Per-user cooldown: 40s between messages
- Per-user burst limit: max 2 messages/minute
- Global cap: 45 messages/minute
- Daily cap: 300 replies/day

## Evolution API Configuration
- Base URL: `https://evolution.s3odyn8n.tech`
- Endpoint used for sending: `/message/sendText/{instance}`
- Header: `apikey` from environment variable (recommended)

Example runtime variable:
- `EVOLUTION_API_KEY=your_real_api_key`

Important: use API endpoint URL, not manager UI URL.

## n8n Import (workflow واحد)

1. افتحي n8n → Workflows → Import from file
2. اختاري **`full-whatsapp-bot-yassmin-workflow.json`** فقط
3. أعيدي ربط credential الخاص بـ Google Sheets على كل عقد Sheets
4. عطّلي أو احذفي أي workflow قديم مستورد منفصل (`whatsapp-bot…` أو `whatsapp-payment…`) حتى لا يتكرر الـ webhook أو كرون الدفع على نفس الشيت / Evolution
5. فعّلي **`FULL WhatsApp BOT Yassmin`** فقط

للمتحكمات التشغيلية، استوردي أيضًا:
- `n8n-control-webhooks-workflow.json`

## Payment Confirmation Reliability Additions
The payment workflow now supports:
- Locking: `locked_at`, `lock_owner`
- Retry policy: `retry_count`, `max_retries`, `next_retry_at`
- Dead-letter status: `dead_letter`, `whatsapp_status=dead_letter`
- Observability fields: `event_type`, `stage`, `result`, `error_code`, `last_http_status`, `latency_ms`

## Testing Checklist

### Core reply flow
1. Send `hello` from WhatsApp
2. Confirm execution reaches `HTTP: Send Reply`
3. Confirm reply is delivered
4. Confirm row is appended in `message_log`

### Email lead capture
| Scenario | Message | Expected result |
|---|---|---|
| New email | `عايزة استشارة، إيميلي user@test.com` | New row in `email_leads`, status=new |
| Repeat email | Same email again | Existing row updated, status=updated, last_seen_at refreshed |
| No email | `hello` | No op in email path, message_log still written |
| Mixed-case email | `User@TEST.com` | Normalized to `user@test.com`, matches existing row |

## Common Errors
- `instance does not exist`: wrong `{instance}` in send URL
- `exists:false`: LID/number resolution issue from webhook data
- `unexecuted node` in expressions: expression references a node not guaranteed in current run path

## Notes
- The workflow includes in-flow notes on key nodes for easier maintenance.
- Keep keyword rows clean and ensure `default` fallback exists.
- A `Code: Resolve LID Phone` node exists in the file but is currently not in the active path.
- The `email_leads` sheet must be created before activating the workflow. Run `setup-google-sheets.js` or create the tab manually with the headers above.
- The email lead path runs **after** every successful reply. Messages without an email are silently skipped (no error, no row).
- The `email_leads` sheet is the source data for the next workflow (email sending / follow-up).

## Dashboard MVP
Run locally:

1. Set env vars:
   - `DASHBOARD_ADMIN_TOKEN`
   - `CONTROL_WEBHOOK_URL` (Production/Test webhook URL from `n8n-control-webhooks-workflow.json`)
2. Start server:
   - `npm run dashboard:start`
3. Open:
   - `http://localhost:8088`

Dashboard modules:
- Operations: pause/resume/retry failed
- Rules & Content: send rule update payloads
- Overview: API health
- Logs: latest control responses
