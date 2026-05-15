# Supabase — قاعدة بيانات مشروع Yassmin WhatsApp

## الهيكل

كل جداول الأتمتة في **schema منفصل** اسمه `yassmin` (لا تختلط مع جداول تطبيقات أخرى في نفس المشروع):

| الجدول | الغرض |
|--------|--------|
| `yassmin.payments` | عمليات الدفع + حالة واتساب |
| `yassmin.product_pdf_map` | ربط `product_code` → رابط PDF أو [مجلد Google Drive](https://drive.google.com) |
| `yassmin.keywords` | ردود البوت — من اللوحة **ردود البوت** أو `GET …/yassmin-dashboard-api/keywords` لـ n8n |
| `yassmin.message_log` | سجل الرسائل |
| `yassmin.email_leads` | ليدز الإيميل |
| `yassmin.paused_chats` | إيقاف البوت عند تدخل بشري |
| `yassmin.bot_outbound` | تتبع رسائل البوت |

ملفات الـ migration بالترتيب (طبّقي كل ما فات في **SQL Editor** أو `supabase db push`):

| الملف | الغرض |
|--------|--------|
| `20260515120000_yassmin_whatsapp_init.sql` | إنشاء schema والجداول الأساسية |
| `20260515130000_yassmin_chat_threads.sql` | خيوط المحادثة (إن وُجد) |
| `20260515140000_expose_yassmin_schema.sql` | تعرّض الـ schema لـ API |
| `20260515150000_yassmin_receipts_storage.sql` | عمود `receipt_url` + bucket `receipts` |
| `20260515180000_product_pdf_drive_folders.sql` | **روابط مجلدات Drive الحقيقية** لـ `inner_compass` و `voltaren_social` |

ملف الـ SQL القديم المرجعي (جزء من السلسلة أعلاه): `supabase/migrations/20260515120000_yassmin_whatsapp_init.sql`

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

## كلمات الرد (`yassmin.keywords`)

- **اللوحة**: تبويب **«ردود البوت»** — يحتاج `SUPABASE_SERVICE_ROLE_KEY` على الخادم الذي يشغّل الـ API (محليًا أو Vercel).
- **قراءة لـ n8n** (بدل شيت `keywords`):  
  `GET https://المشروع.supabase.co/functions/v1/yassmin-dashboard-api/keywords`  
  مع ترويسات `apikey` و `Authorization: Bearer <SUPABASE_ANON_KEY>`. الاستجابة: `{ "ok": true, "keywords": [ { "id", "keyword", "reply", "active", "sort_order", … } ] }`.
- **كتابة من Edge** (اختياري): `POST/PATCH/DELETE …/keywords` مع ترويسة `x-admin-token` نفس `DASHBOARD_ADMIN_TOKEN` إن وُجدت على الدالة.

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

**لو تبويب «الرسائل» في اللوحة فاضي:** تأكدي أن workflow البوت يستدعي `POST .../yassmin-dashboard-api/ingest/message` بعد كل رسالة. لو عندك `N8N_WEBHOOK_SECRET` على دالة Edge، لازم نفس القيمة تُرسل من n8n في ترويسة `x-n8n-secret` وإلا الـ ingest يرجع 401 ولا يُسجَّل شيء في `message_log`.

## كرون إرسال واتساب (Supabase — كل 30 دقيقة)

الاستقبال التلقائي بعد التأكيد يعتمد على **n8n** وليس على Vercel.

1. **نشر Edge Function `yassmin-payments-api`** بعد آخر تعديل (يدعم `GET ?pending_whatsapp=1&limit=20`: صفوف `done=true` و`dead_letter=false` و`whatsapp_status` فارغ أو `failed`، حتى `limit` صف كحد أقصى).
2. استورد **`payment-auto-send-cron-supabase-n8n-workflow.json`** في n8n و**فعّل** الـ workflow.
3. عرّف متغيرات البيئة في n8n (أو استبدل التعبيرات في العقد):
   - `YASSMIN_SUPABASE_FUNCTIONS_URL` — مثل `https://المشروع.supabase.co/functions/v1` (بدون شرطة أخيرة)
   - `SUPABASE_ANON_KEY`
   - `EVOLUTION_API_URL`، `EVOLUTION_INSTANCE`، `EVOLUTION_API_KEY`
4. **عطّل** مسار **«Cron: Every 30 Minutes»** الذي يقرأ **Google Sheets** في `full-whatsapp-bot-yassmin-workflow.json` أو `whatsapp-payment-confirmation-workflow.json` حتى لا يحدث إرسال مزدوج لصفوف ما زالت على الشيت.

زر **«إرسال الآن»** في الداشبورد يظل يعمل فورًا من Vercel بغض النظر عن الكرون.

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

## أخطاء Vercel / النشر — لماذا تتكرر؟

1. **قاعدة مجلد `api/`**  
   كل ملف `api/**/*.js` يُعامَل كـ **Serverless Function** ولا بد أن يصدّر **معالج طلب واحد** (`module.exports = async (req, res) => { ... }`).  
   أي ملف تحت `api/` ليس handler (مثل مكتبة مشتركة، `lib/*.js`، سكربت مساعد) غالبًا يسبب فشل البناء مثل **Invalid serverless function** — نفس سبب نقل `action-history` خارج `api/` سابقًا.  
   **الاستثناء الشائع:** الملفات التي اسمها يبدأ بـ **`_`** (مثل `_helpers.js`) لا تُعرَّف كـ Route في إعدادات Vercel الكلاسيكية، فتبقى للـ `require` فقط — لا تضيفي ملفات عادية تحت `api/` بدون `_`.

2. **المسارات عميقة**  
   تجنّبي تعارض الأسماء مع مجلدات (مثل مسار يتوقعه المتصفح كـ «مجلد»). حُل سابق: **`/api/messages-thread`** كملف واحد بدل `api/messages/thread.js`.

3. **تشغيل محلي مقابل النشر**  
   **`vercel dev`** و**Production** يقرآن متغيرات البيئة من لوحة Vercel؛ لو الـ env غير مضبوطة على المشروع (أو على Preview فقط) تظهر نفس الأخطاء **503 / unauthorized** رغم أن المحلي يعمل مع `.env`.

4. **لوحة التحكم بعد آخر ميزات**  
   تبويب **ردود البوت** ومسارات مثل `PATCH /api/keywords` يحتاجان **`SUPABASE_SERVICE_ROLE_KEY`** على Vercel (قراءة/كتابة `yassmin.keywords`). بدون المفتاح يظهر خطأ إعداد وليس بالضرورة فشل build.

5. **Edge Functions منفصلة**  
   تغييرات على `supabase/functions/...` **لا تُنشر مع Vercel** — لازم **`supabase functions deploy`**؛ إلا ستظل الواجهة أو n8n تضرب كودًا قديمًا على Supabase.
