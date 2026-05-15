# n8n — مسار Supabase فقط (الداشبورد)

## الملفات

| ملف | الغرض |
|-----|--------|
| [`whatsapp-bot-yassmin-supabase-only.json`](whatsapp-bot-yassmin-supabase-only.json) | بوت واتساب: ويب هوك، كلمات مفتاحية من Supabase، dedup من `message_log`، `bot_outbound` من DB، ingest — **بدون Google Sheets** وبدون كرون الدفعات. يُولَّد من [`scripts/build-whatsapp-supabase-only-workflow.mjs`](scripts/build-whatsapp-supabase-only-workflow.mjs). |
| [`payment-auto-send-cron-supabase-n8n-workflow.json`](payment-auto-send-cron-supabase-n8n-workflow.json) | كرون كل 30 دقيقة: دفعات معلّقة من `yassmin-payments-api` + منتجات + paused chats — Supabase فقط. |
| [`payment-send-now-n8n-workflow.json`](payment-send-now-n8n-workflow.json) | إرسال تأكيد دفعة واحدة عبر Webhook. |

## متغيرات بيئة n8n

- `SUPABASE_ANON_KEY` — مطلوب لجميع طلبات `yassmin-dashboard-api` و`yassmin-payments-api`.
- `SUPABASE_URL` (مثل `https://<ref>.supabase.co`) — يُستخدم تلقائيًا في **كرون الدفعات** لبناء `.../functions/v1` إن لم تُضبط `YASSMIN_SUPABASE_FUNCTIONS_URL`.
- `YASSMIN_SUPABASE_FUNCTIONS_URL` (اختياري) — إن وُجدت، تُستخدم كاملة لقاعدة المسارات (مثل `https://<ref>.supabase.co/functions/v1`) وتتقدّم على `SUPABASE_URL`.
- `N8N_WEBHOOK_SECRET` (اختياري لكن مُفضّل): عند التفعيل، أرسلي أيضًا الهيدر `x-n8n-secret` في عُقد HTTP نفسها إذا طلبتم قفلًا أشدّ على الـ Edge لاحقًا؛ حاليًا يُقبل anon + Bearer كما في عُقد `ingest`.

## Edge — مسارات جديدة لـ n8n

في [`supabase/functions/yassmin-dashboard-api/index.ts`](supabase/functions/yassmin-dashboard-api/index.ts):

- `GET /message-log/recent?limit=` — يتطلب `requireN8n`؛ يعيد `rows` بحقول `timestamp`, `phone`, `message`, `message_id` (متوافقة مع كود Dedup).
- `GET /bot-outbound/recent?limit=` — نفس الصلاحية؛ صفوف `message_id`, `phone`, `sent_at`, `source`.

بعد تغيير الـ Edge: `supabase functions deploy yassmin-dashboard-api` (أو نشر عبر MCP). إذا ظهرت على المشروع نسخة بملف `index.ts` غير مكتمل (مثلاً placeholder)، أعيدي النشر من الريبو فورًا حتى لا ينقطع الداشبورد أو n8n.

## تحقق بعد النشر (فني)

- في Supabase MCP: `get_edge_function` لـ `yassmin-dashboard-api` يجب أن يعيد محتوى `index.ts` الكامل (يبدأ بـ `import "jsr:@supabase/functions-js/edge-runtime.d.ts"`).
- HTTP سريع: `GET https://<ref>.supabase.co/functions/v1/yassmin-dashboard-api/keywords` يجب أن يعيد `200` و`"ok":true`.
- مسارات n8n المحمية: `GET .../message-log/recent` و`GET .../bot-outbound/recent` تتطلب نفس صلاحيات `requireN8n` (anon في الهيدر، أو `x-n8n-secret` إذا ضُبط `N8N_WEBHOOK_SECRET`).

## خطوات التشغيل

1. استوردي `whatsapp-bot-yassmin-supabase-only.json` في n8n وفعّلي الـ workflow.
2. اربطي Webhook إيفوليوشن (Evolution) بمسار الـ webhook الجديد كما كان سابقًا.
3. استوردي/فعّلي `payment-auto-send-cron-supabase-n8n-workflow.json` لكرون الدفعات. عناوين Edge تُحسب من `YASSMIN_SUPABASE_FUNCTIONS_URL` أو `SUPABASE_URL` + `/functions/v1`، مع احتياطي لمشروعك الحالي في الملف.
4. إن وُجدت عندكم نسخ قديمة على n8n (Sheets أو workflow كامل مختلط)، عطّليها لتفادي ازدواج الردود أو كرون الدفعات.

## فرع الإيميل في الـ workflow الجديد

حاليًا يتوقف عند عُقد **No Op (deferred)** — التسجيل في `yassmin.email_leads` عبر الشيت لا يعمل. يمكن لاحقًا ربط فرع `IF: Has Email?` بـ Edge أو عقدة Postgres.

## إعادة توليد الـ workflow البوت

```bash
npm run build:bot-workflow
# أو مع مشروع Supabase آخر:
# YASSMIN_DASHBOARD_API_BASE=https://REF.supabase.co/functions/v1/yassmin-dashboard-api npm run build:bot-workflow
```

## تحقق يدوي سريع

- رسالة تحتوي كلمة من الداشبورد → رد آلي + سطر في `message_log`.
- محادثة في وضع **paused** → لا رد آلي؛ تسجيل `human_handoff` حسب المسار.
- كرون الدفعات → صف واحد pending يتلقى واتساب (workflow الكرون أعلاه فقط).
