# Part 1 — Google Sheets Setup
> **Status:** Do this FIRST before touching n8n  
> **Time estimate:** 20–30 minutes  
> **Dependency:** Google account with Sheets access

---

## What You're Building

Two sheets inside one Google Spreadsheet:
1. `keywords` — the keyword → reply mapping table (editable by anyone)
2. `message_log` — auto-filled audit log of every message received

---

## Step 1: Create the Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) → New Spreadsheet
2. Rename it: `WhatsApp Bot Data`
3. Copy the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
   Save this ID — you'll need it in n8n.

---

## Step 2: Create `keywords` Sheet

Rename `Sheet1` to `keywords`.

Add these exact column headers in Row 1:

| A | B | C |
|---|---|---|
| `keyword` | `reply` | `active` |

### Rules:
- Column A (`keyword`): comma-separated trigger words — bot checks if message **contains** any of them
- Column B (`reply`): exact text to send back — supports emoji ✅
- Column C (`active`): `TRUE` or `FALSE` — set to FALSE to disable a row without deleting it

### Starter Data (copy this in):

| keyword | reply | active |
|---|---|---|
| `hello, hi, مرحبا, أهلاً, أهلا, هاي, السلام` | `👋 Hello! How can we help you today? Reply with *price*, *location*, or *hours*.` | TRUE |
| `price, prices, سعر, الأسعار, بكام, كام` | `💰 Our pricing:\n- Service A: $50\n- Service B: $80\nReply to book!` | TRUE |
| `location, address, عنوان, فين, وين` | `📍 Address: 123 Main St\nGoogle Maps: https://maps.app.goo.gl/YOURLINK` | TRUE |
| `hours, working hours, مواعيد, ساعات, امتى` | `🕐 Working hours: Sat–Thu, 9am–6pm. Fri: closed.` | TRUE |
| `human, agent, موظف, كلمني, واحد` | `👤 Got it! A team member will reach out shortly. Please hold. 🙏` | TRUE |
| `default` | `😊 Sorry, didn't catch that! Reply with:\n*price* 💰 *location* 📍 *hours* 🕐` | TRUE |

> ⚠️ The `default` row MUST be the last row. The matcher reads top-to-bottom and stops at first match.

---

## Step 3: Create `message_log` Sheet

Add a new sheet tab → rename it `message_log`.

Add these headers in Row 1:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| `timestamp` | `phone` | `message` | `keyword_matched` | `reply_sent` | `status` |

Leave the rest empty — n8n will fill it automatically.

---

## Step 4: Set Up Google OAuth2 in n8n

### 4.1 Create Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. New Project → name it `n8n-whatsapp-bot`
3. Enable these APIs:
   - Google Sheets API
   - Google Drive API (needed for Sheets access)

### 4.2 Create OAuth2 Credentials

1. APIs & Services → Credentials → Create Credentials → OAuth Client ID
2. Application type: **Web application**
3. Authorized redirect URIs — add:
   ```
   https://YOUR_N8N_DOMAIN/rest/oauth2-credential/callback
   ```
4. Download the JSON — you'll need Client ID + Client Secret

### 4.3 Add to n8n

1. n8n → Credentials → New → Google Sheets OAuth2 API
2. Paste Client ID + Client Secret
3. Click **Sign in with Google** → authorize
4. Save as: `Google Sheets - WhatsApp Bot`

---

## Deliverables After This Part

- [ ] Spreadsheet ID saved somewhere safe
- [ ] `keywords` sheet has headers + starter rows
- [ ] `message_log` sheet has headers
- [ ] Google OAuth2 credential created and connected in n8n
- [ ] Credential name noted: `Google Sheets - WhatsApp Bot`

---

*Next: Part 2 — n8n Workflow Core (Webhook + Filter + Matcher)*
