# Part 2 — n8n Workflow Core
> **Status:** Build after Part 1 is done  
> **Time estimate:** 45–60 minutes  
> **Dependencies:** n8n running, Evolution API running, Google Sheets credential ready

---

## Assumptions (Already Done)

- n8n is self-hosted and reachable at `https://YOUR_N8N_DOMAIN`
- Evolution API is running and WhatsApp account is connected
- Google Sheets credential exists in n8n named `Google Sheets - WhatsApp Bot`
- Spreadsheet ID is saved

---

## Workflow Overview

```
Webhook → Filter → Extract Fields → Read Keywords → Match → IF Match → [Part 3]
```

This part covers nodes 1–6. Sending the reply and logging are in Part 3.

---

## Node 1: Webhook

| Setting | Value |
|---|---|
| Name | `Webhook: Receive WA Message` |
| HTTP Method | POST |
| Path | `whatsapp` |
| Respond | Immediately |

> **Critical:** Set "Respond" to **Immediately** — return 200 right away. Do NOT wait for workflow to finish. Evolution API will retry if response takes too long.

After saving, copy the webhook URL:
```
https://YOUR_N8N_DOMAIN/webhook/whatsapp
```
You'll register this in Evolution API (see Part 2, Step 6).

---

## Node 2: IF — Filter Valid Message

**Name:** `IF: Valid Message?`

Add 4 conditions (ALL must be true):

### Condition 1 — Not sent by self
```
Value 1:  {{ $json.data.key.fromMe }}
Operation: Equal
Value 2:  false
```

### Condition 2 — Has text content
```
Value 1:  {{ $json.data.message?.conversation ?? $json.data.message?.extendedTextMessage?.text ?? '' }}
Operation: Is Not Empty
```

### Condition 3 — Message is recent (under 60 seconds old)
```
Value 1:  {{ (Date.now() / 1000) - $json.data.messageTimestamp }}
Operation: Smaller Than
Value 2:  60
```

### Condition 4 — Not a group message
```
Value 1:  {{ $json.data.key.remoteJid }}
Operation: Does Not Contain
Value 2:  @g.us
```

**TRUE branch** → continue to Node 3  
**FALSE branch** → connect to a **No Operation** node (end silently)

---

## Node 3: Set — Extract Fields

**Name:** `Set: Extract Fields`

Add these fields:

| Field Name | Expression |
|---|---|
| `phone` | `{{ $json.data.key.remoteJid.replace('@s.whatsapp.net', '') }}` |
| `message_text` | `{{ ($json.data.message?.conversation ?? $json.data.message?.extendedTextMessage?.text ?? '').toLowerCase().trim() }}` |
| `message_id` | `{{ $json.data.key.id }}` |
| `received_at` | `{{ new Date($json.data.messageTimestamp * 1000).toISOString() }}` |

---

## Node 4: Google Sheets — Read Keywords

**Name:** `Sheets: Read Keywords`

| Setting | Value |
|---|---|
| Credential | `Google Sheets - WhatsApp Bot` |
| Operation | Get Many Rows |
| Spreadsheet ID | `YOUR_SPREADSHEET_ID` |
| Sheet Name | `keywords` |
| Filter | Column C (`active`) = `TRUE` |
| Return All | Yes |

> This loads the full keyword table on every message. It's fine for low volume. If you expect 1000+ messages/day, cache this with a separate scheduled workflow.

---

## Node 5: Code — Keyword Matcher

**Name:** `Code: Keyword Matcher`

**Mode:** Run Once for All Items

```javascript
const message = $('Set: Extract Fields').first().json.message_text;
const rows = $input.all().map(item => item.json);

let matched = null;

for (const row of rows) {
  // Skip inactive rows (extra safety check)
  if (row.active === false || row.active === 'FALSE') continue;
  
  // Skip the default row — handle it at the end
  if (row.keyword.trim().toLowerCase() === 'default') continue;

  const keywords = row.keyword.toLowerCase().split(',').map(k => k.trim());
  
  for (const kw of keywords) {
    if (kw && message.includes(kw)) {
      matched = row;
      break;
    }
  }
  
  if (matched) break;
}

// If no match, use the default row
if (!matched) {
  matched = rows.find(r => r.keyword.trim().toLowerCase() === 'default') 
    || { keyword: 'default', reply: "Sorry, I didn't understand that. Please try again." };
}

return [{
  json: {
    keyword_matched: matched.keyword,
    reply: matched.reply,
    phone: $('Set: Extract Fields').first().json.phone,
    message_text: $('Set: Extract Fields').first().json.message_text,
    message_id: $('Set: Extract Fields').first().json.message_id,
    received_at: $('Set: Extract Fields').first().json.received_at,
  }
}];
```

---

## Node 6: IF — Match Quality Check

**Name:** `IF: Has Reply?`

```
Value 1:  {{ $json.reply }}
Operation: Is Not Empty
```

**TRUE** → continue to Part 3 (delay + send + log)  
**FALSE** → No Operation (silent end — should never happen if default row exists)

---

## Step 6: Register Webhook in Evolution API

After the Webhook node is saved in n8n, register it in Evolution API:

```http
POST http://localhost:8080/webhook/set/my-business
Headers:
  apikey: YOUR_EVOLUTION_API_KEY
  Content-Type: application/json

Body:
{
  "url": "https://YOUR_N8N_DOMAIN/webhook/whatsapp",
  "webhook_by_events": true,
  "events": ["MESSAGES_UPSERT"]
}
```

### Verify it's registered:
```http
GET http://localhost:8080/webhook/find/my-business
Headers:
  apikey: YOUR_EVOLUTION_API_KEY
```

---

## Test This Part Before Moving On

Send a WhatsApp message to your connected number and check:

1. n8n Executions tab shows a new run
2. Node 2 (Filter) passes — TRUE branch fires
3. Node 3 (Extract Fields) shows correct `phone` and `message_text`
4. Node 4 (Read Keywords) shows all your keyword rows
5. Node 5 (Matcher) shows `keyword_matched` and `reply` fields populated
6. Node 6 passes TRUE branch

If filter fails, check the raw webhook payload in Node 1 output and verify the field paths match.

---

## Deliverables After This Part

- [ ] Webhook node created + URL registered in Evolution API
- [ ] Filter working — test message passes through
- [ ] Fields extracting correctly (phone, message_text, message_id)
- [ ] Keyword table loading from Sheets
- [ ] Matcher returning correct `keyword_matched` + `reply`
- [ ] Workflow saved and **Active** toggle is ON

---

*Next: Part 3 — Anti-Ban Delay + Send Reply + Logging*
