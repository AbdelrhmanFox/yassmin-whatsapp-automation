# نشر لوحة التحكم على Vercel

اللوحة وواجهات `api/` تعتمد على **Supabase** (Edge + `yassmin`). لا حاجة لـ Google Sheets على Vercel.

## 1) رفع المستودع

تأكدي ألا يُرفع: `.env`, `node_modules/`, مفاتيح سرية.

## 2) مشروع Vercel

1. استوردي المستودع، **Root** = جذر المشروع (فيه `vercel.json`).
2. **Environment Variables** (Production) — انسخي من [`.env.example`](../.env.example) في الجذر:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (أو anon + دوال Edge حسب إعدادكم)
- `SUPABASE_PAYMENTS_FUNCTION_URL`, `SUPABASE_DASHBOARD_FUNCTION_URL`
- `SUPABASE_ANON_KEY` إن استخدمتم Edge للقراءة
- `DASHBOARD_ADMIN_TOKEN`, `DASHBOARD_DISABLE_AUTH`
- `EVOLUTION_*` لزر «إرسال الآن» من اللوحة

3. Deploy → `https://your-app.vercel.app`

## 3) n8n

استوردي من الجذر:

- `whatsapp-bot-yassmin-supabase-only.json`
- `payment-auto-send-cron-supabase-n8n-workflow.json`
- `payment-send-now-n8n-workflow.json`

التهيئة: [`N8N-SUPABASE-ONLY.md`](N8N-SUPABASE-ONLY.md)

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `unauthorized` | `DASHBOARD_ADMIN_TOKEN` في الواجهة أو تعطيل المصادقة للتجربة |
| اللوحة فارغة | تحققي من `SUPABASE_SERVICE_ROLE_KEY` أو أن دوال Edge تستخدم `service_role` داخلياً |
| ردود البوت لا تُحفظ | `SUPABASE_DASHBOARD_FUNCTION_URL` + `SUPABASE_ANON_KEY` |
