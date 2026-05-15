# أتمتة واتساب (Supabase + لوحة تحكم + n8n)

## ما في المشروع

| المسار | الوصف |
|--------|--------|
| `dashboard/` | لوحة عمليات الدفع، الرسائل، ردود البوت (`yassmin.keywords`) |
| `api/` | نقاط نهاية Vercel (صحة، دفعات، رسائل، …) |
| `supabase/` | Edge Functions + migrations |
| **`whatsapp-bot-yassmin-supabase-only.json`** | بوت واتساب — Supabase فقط |
| **`payment-auto-send-cron-supabase-n8n-workflow.json`** | كرون تأكيد الدفع كل 30 د |
| **`payment-send-now-n8n-workflow.json`** | إرسال دفعة واحدة (Webhook) |
| `scripts/build-whatsapp-supabase-only-workflow.mjs` | إعادة توليد ملف البوت |
| `scripts/migrate-csv-to-supabase.mjs` | ترحيل دفعات من CSV عام (اختياري) |

## البدء

1. انسخي `.env.example` → `.env` وعبّي مفاتيح Supabase و Evolution.
2. لوحة محلية: `npm install && npm run dashboard:start` → `http://localhost:8088`
3. n8n: استوردي ملفات الـ JSON أعلاه — التفاصيل في **`N8N-SUPABASE-ONLY.md`**
4. نشر Vercel: **`DEPLOY-VERCEL.md`**
5. قاعدة البيانات و Edge: **`DEPLOY-SUPABASE.md`**

```bash
npm run build:bot-workflow   # يحدّث whatsapp-bot-yassmin-supabase-only.json
```
