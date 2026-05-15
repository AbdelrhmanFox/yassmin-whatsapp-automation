# Dashboard — Yassmin Ops

لوحة لمتابعة **عمليات الدفع** على Supabase، **رسائل واتساب**، **ردود البوت** (`keywords`)، وتحكم اختياري في n8n.

## Features

- **عمليات الدفع**: تأكيد الدفع، إرسال واتساب فوري، KPIs — من `yassmin.payments`
- **الرسائل**: محادثات وسجل — من `message_log` / Edge
- **ردود البوت**: جدول `yassmin.keywords` (كلمات مفصولة بفواصل → نص الرد) — بديل تبويب الشيت
- تبويب **تحكم الأتمتة**: pause / resume / retry (عبر webhook اختياري)

## Start (Supabase)

1. متغيرات البيئة: انسخي `.env.example` من جذر المشروع — `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، واختياري `SUPABASE_DASHBOARD_FUNCTION_URL`.

2. تشغيل اللوحة:

```bash
npm run dashboard:start
```

3. افتحي: `http://localhost:8088`

## Security Notes

- Admin token is required for `/api/control` and للـ API المحمية عند `DASHBOARD_DISABLE_AUTH=false`.
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
