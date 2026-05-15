# نشر المشروع على GitHub + Vercel

قاعدة البيانات = **Google Sheets** (ليس SQL):

| الغرض | الرابط |
|--------|--------|
| بوت + paused + bot_outbound | [WhatsApp Bot Data](https://docs.google.com/spreadsheets/d/1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY) |
| عمليات الدفع | [عمليات الدفع](https://docs.google.com/spreadsheets/d/1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w) |

الأتمتة (n8n) تبقى على سيرفرك؛ اللوحة على Vercel تقرأ/تكتب الشيت مباشرة.

---

## 1) Google Service Account (مطلوب لـ Vercel)

1. [Google Cloud Console](https://console.cloud.google.com/) → مشروع → **APIs** → فعّلي **Google Sheets API**.
2. **IAM → Service Accounts** → Create → حمّلي مفتاح **JSON**.
3. افتحي الملف وانسخي **المحتوى كاملًا** (سطر واحد) إلى متغير Vercel:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = `{ "type": "service_account", ... }`
4. من الملف انسخي `client_email` (مثل `xxx@xxx.iam.gserviceaccount.com`).
5. **شاركي الشيتين** مع هذا الإيميل كـ **Editor**:
   - WhatsApp Bot Data
   - عمليات الدفع

---

## 2) رفع GitHub

من مجلد المشروع:

```powershell
git init
git add .
git commit -m "WhatsApp automation: n8n workflows, dashboard, Vercel API"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

تأكدي أن **لا يُرفع**: `google-tokens.json`, `.env`, `node_modules/`, `*.xlsx`.

---

## 3) نشر Vercel

1. [vercel.com](https://vercel.com) → **Add Project** → Import من GitHub.
2. **Root Directory**: جذر المستودع (فيه `vercel.json`).
3. **Environment Variables** (Production):

| المتغير | القيمة |
|---------|--------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON كامل للـ service account |
| `PAYMENT_SPREADSHEET_ID` | `1DoDcs3QnwDmkNim8OKQ7wm3I8JJoQiwhIcHamHo6a8w` |
| `BOT_SPREADSHEET_ID` | `1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY` |
| `PAYMENT_SHEET_NAME` | `عمليات الدفع` |
| `DASHBOARD_ADMIN_TOKEN` | كلمة سر قوية للوحة |
| `DASHBOARD_DISABLE_AUTH` | `false` |

4. Deploy → افتحي `https://your-app.vercel.app`

5. في اللوحة: الصقّي نفس `DASHBOARD_ADMIN_TOKEN` في حقل التوكن.

---

## 4) MCP + n8n (على السيرفر — ليس Vercel)

- استوردي [`full-whatsapp-bot-yassmin-workflow.json`](full-whatsapp-bot-yassmin-workflow.json) في n8n.
- اتبعي [`MCP-n8n-implementation-guide.md`](MCP-n8n-implementation-guide.md).
- مثال إعداد Cursor: [`.cursor/mcp.json.example`](.cursor/mcp.json.example)

---

## 5) تدفق العمل

```
فورم الدفع → شيت عمليات الدفع
لوحة Vercel → تعديل عمود done
n8n (كل 30 دقيقة) → واتساب تأكيد + PDF
واتساب بوت → شيت البوت (keywords, paused_chats, …)
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `unauthorized` | أدخلي `DASHBOARD_ADMIN_TOKEN` في اللوحة |
| `Google auth not configured` | أضيفي `GOOGLE_SERVICE_ACCOUNT_JSON` على Vercel |
| `permission denied` على الشيت | شاركي الشيت مع إيميل الـ service account |
| التعديل لا يظهر في n8n | تأكدي عمود `done` = TRUE وليس نصًا آخر |
