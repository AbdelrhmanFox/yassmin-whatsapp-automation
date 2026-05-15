# Dashboard — عمليات الدفع (SaaS)

لوحة لمتابعة شيت **عمليات الدفع** وتعديل عمود **تم تأكيد الدفع** (`done`) مباشرة — مربوطة بـ workflow n8n.

## Features

- **جدول عمليات الدفع** من Google Sheets (قراءة/كتابة مباشرة)
- **تبديل تأكيد الدفع** — يكتب `TRUE` أو يفرّغ الخلية؛ عند الإلغاء يُصفّر `whatsapp_status` لإعادة الإرسال
- **KPIs**: بانتظار المراجعة، مؤكد بانتظار واتساب، مُرسل، فشل
- **بحث وفلترة** حسب الحالة
- تبويب **تحكم الأتمتة**: pause / resume / retry (عبر webhook اختياري)

## Start

1. ربط Google (مرة واحدة من جذر المشروع):

```bash
npm run sync:google-sheets
```

2. تشغيل اللوحة:

```bash
npm run dashboard:start
```

3. افتحي: `http://localhost:8088`

متغيرات البيئة: انسخي `dashboard/.env.example` — الأهم `PAYMENT_SPREADSHEET_ID` وملف `google-tokens.json` في جذر المشروع.

## Security Notes

- Admin token is required for `/api/control`.
- Use HTTPS + reverse proxy in production.
- Rotate `DASHBOARD_ADMIN_TOKEN` periodically.
- For localhost-only usage you can set `DASHBOARD_DISABLE_AUTH=true`.

## Metrics Webhook Contract

`METRICS_WEBHOOK_URL` should return either:

1) array of rows, or  
2) object with `rows` array.

Expected row keys (best effort):
- `whatsapp_status`
- `dead_letter`
- `next_retry_at`
- `latency_ms`
