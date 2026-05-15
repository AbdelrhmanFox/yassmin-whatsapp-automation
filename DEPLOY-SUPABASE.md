# Supabase — قاعدة بيانات مشروع Yassmin WhatsApp

## الهيكل

كل جداول الأتمتة في **schema منفصل** اسمه `yassmin` (لا تختلط مع جداول تطبيقات أخرى في نفس المشروع):

| الجدول | الغرض |
|--------|--------|
| `yassmin.payments` | عمليات الدفع + حالة واتساب |
| `yassmin.product_pdf_map` | ربط `product_code` → رابط PDF |
| `yassmin.keywords` | ردود البوت |
| `yassmin.message_log` | سجل الرسائل |
| `yassmin.email_leads` | ليدز الإيميل |
| `yassmin.paused_chats` | إيقاف البوت عند تدخل بشري |
| `yassmin.bot_outbound` | تتبع رسائل البوت |

ملف الـ SQL في المستودع: `supabase/migrations/20260515120000_yassmin_whatsapp_init.sql`

## إعداد المشروع

1. [supabase.com](https://supabase.com) → مشروع جديد (أو استخدم المشروع المربوط بـ MCP).
2. **SQL Editor** → الصق محتوى ملف الـ migration إن لم يُطبَّق بعد.
3. **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (سيرفر فقط — لا تضعه في المتصفح)

## متغيرات البيئة (Vercel / محلي)

```env
DATABASE_PROVIDER=supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_SCHEMA=yassmin
DASHBOARD_ADMIN_TOKEN=توكن-قوي
DASHBOARD_DISABLE_AUTH=false
```

لوحة التحكم تستخدم Supabase تلقائياً عند وجود المفاتيح. للرجوع لـ Sheets مؤقتاً: `DATABASE_PROVIDER=sheets`.

## ترحيل البيانات من Google Sheets

```bash
cp .env.example .env
# املأ Google OAuth + Supabase keys
npm install
npm run migrate:sheets-to-supabase
```

المفتاح الفريد لكل دفعة: **`form_timestamp`** (= عمود `طابع زمني` في الفورم).

## n8n + Supabase

استبدل عقد **Google Sheets** بعقد **Supabase** (أو HTTP Request إلى REST):

- **Schema**: `yassmin`
- **قراءة دفعات للإرسال**: `payments` حيث `done = true` و `whatsapp_status` فارغ أو `failed`
- **بعد الإرسال**: `UPDATE` على `form_timestamp` → `whatsapp_status`, `whatsapp_sent_at`
- **خريطة PDF**: `product_pdf_map` حسب `product_code`
- **paused_chats / bot_outbound / keywords**: نفس أسماء التبويبات السابقة في Sheets

مثال فلتر (PostgREST):

```
GET /rest/v1/payments?done=eq.true&whatsapp_status=is.null
Header: apikey + Authorization: Bearer SERVICE_ROLE
Header: Accept-Profile: yassmin
```

## Google Form

خياران:

1. **مؤقت**: الفورم يبقى على Sheets + `npm run migrate:sheets-to-supabase` دورياً.
2. **نهائي**: Webhook من n8n عند إرسال الفورم → `INSERT` في `yassmin.payments`.
