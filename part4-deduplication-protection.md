# Part 4 — Deduplication + Volume Protection
> **Status:** Build after Part 3 end-to-end test passes  
> **Time estimate:** 30 minutes  
> **Why this matters:** Without this, the bot can reply twice to the same message, and can get banned if too many replies fire in a short window

---

## Problem 1: Duplicate Replies

Evolution API can occasionally fire the same `MESSAGES_UPSERT` event twice for one message. Without deduplication, the bot sends two identical replies — looks broken to the user and wastes quota.

**Fix:** Before sending, check if `message_id` was already processed in the log sheet.

---

## Add Deduplication Node (insert between Node 6 and Node 7)

### New Node: Google Sheets — Check Duplicate

**Name:** `Sheets: Check Duplicate`  
**Position:** After `IF: Has Reply?` TRUE branch, before `Wait: Anti-Ban Delay`

| Setting | Value |
|---|---|
| Credential | `Google Sheets - WhatsApp Bot` |
| Operation | Get Many Rows |
| Spreadsheet ID | `YOUR_SPREADSHEET_ID` |
| Sheet Name | `message_log` |
| Filter Column | `message_id` *(add this column to message_log — see below)* |
| Filter Value | `{{ $json.message_id }}` |

### Add `message_id` to `message_log` Sheet

Add a new column G to `message_log`:

| G |
|---|
| `message_id` |

Update Node 9 (Sheets: Append Log) to also write:

| Column | Value |
|---|---|
| `message_id` | `{{ $json.message_id }}` |

### New IF Node: Already Processed?

**Name:** `IF: Already Processed?`  
**Position:** After `Sheets: Check Duplicate`

```
Value 1:  {{ $items().length }}
Operation: Equal
Value 2:  0
```

**TRUE (0 rows = not processed)** → continue to Wait node  
**FALSE (row found = already replied)** → No Operation (skip silently)

---

## Problem 2: Reply Volume Spike

If WhatsApp reconnects after downtime, Evolution API may deliver a backlog of unread messages all at once. Even with the 60s timestamp filter in Part 2, adding a hard daily cap is good practice.

**Fix:** Count today's rows in `message_log` before replying. If over limit, skip.

---

## Add Volume Check Node

**Position:** After `IF: Already Processed?` TRUE branch, before `Wait` node

### New Node: Google Sheets — Count Today's Replies

**Name:** `Sheets: Count Today`

| Setting | Value |
|---|---|
| Operation | Get Many Rows |
| Sheet Name | `message_log` |
| Filter Column | `timestamp` |
| Filter Value | *(see note below)* |

> Google Sheets native filter won't do date comparisons. Use a Code node instead:

### Replace with Code Node: Volume Check

**Name:** `Code: Volume Check`

```javascript
const rows = $input.all().map(r => r.json);
const today = new Date().toISOString().split('T')[0]; // "2024-01-15"

const todayCount = rows.filter(r => 
  r.timestamp && r.timestamp.startsWith(today)
).length;

const DAILY_LIMIT = 300;

return [{
  json: {
    ...$('IF: Already Processed?').first().json,
    today_count: todayCount,
    limit_reached: todayCount >= DAILY_LIMIT
  }
}];
```

### New IF Node: Under Limit?

**Name:** `IF: Under Daily Limit?`

```
Value 1:  {{ $json.limit_reached }}
Operation: Equal
Value 2:  false
```

**TRUE** → continue to Wait node  
**FALSE** → log with status `skipped` (optional) → No Operation

---

## Updated Workflow Map

```
[Webhook]
    │
    ▼
[IF: Valid Message?] ──FALSE──► [No Op]
    │ TRUE
    ▼
[Set: Extract Fields]
    │
    ▼
[Sheets: Read Keywords]
    │
    ▼
[Code: Keyword Matcher]
    │
    ▼
[IF: Has Reply?] ──FALSE──► [No Op]
    │ TRUE
    ▼
[Sheets: Check Duplicate] ◄── NEW
    │
    ▼
[IF: Already Processed?] ──FALSE──► [No Op] ◄── NEW
    │ TRUE
    ▼
[Sheets: Read All Log + Code: Volume Check] ◄── NEW
    │
    ▼
[IF: Under Daily Limit?] ──FALSE──► [No Op] ◄── NEW
    │ TRUE
    ▼
[Wait: Anti-Ban Delay]
    │
    ▼
[HTTP: Send Reply]
    │
    ▼
[Sheets: Append Log]
```

---

## Test Scenarios for This Part

| Test | Expected Result |
|---|---|
| Send same message twice quickly | Bot replies once only |
| Manually set `today_count` to 300 in test | Bot skips reply, no send |
| Normal message under limit | Bot replies normally |
| Check message_log | `message_id` column is populated |

---

## Deliverables After This Part

- [ ] `message_id` column added to `message_log` sheet
- [ ] Duplicate check node in place — confirmed working
- [ ] Daily volume check node in place
- [ ] Updated workflow map matches above
- [ ] All 3 test scenarios pass

---

*This is the final part. The bot is now production-ready.*

---

## Full Checklist — All Parts

### Part 1 — Google Sheets
- [ ] Spreadsheet created with `keywords` and `message_log` sheets
- [ ] Starter keyword rows added
- [ ] Google OAuth2 credential connected in n8n

### Part 2 — Workflow Core
- [ ] Webhook node created and registered in Evolution API
- [ ] Filter, Extract, Read Keywords, Matcher nodes working
- [ ] Test message passing through all 6 nodes correctly

### Part 3 — Send + Log
- [ ] Wait node with random delay
- [ ] HTTP Request sending via Evolution API with typing indicator
- [ ] message_log being populated

### Part 4 — Protection
- [ ] Deduplication preventing double replies
- [ ] Daily volume cap in place
- [ ] End-to-end test: 5 different keywords all work correctly
