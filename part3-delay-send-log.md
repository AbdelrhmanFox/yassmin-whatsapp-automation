# Part 3 — Anti-Ban Delay + Send Reply + Logging
> **Status:** Build after Part 2 is fully tested  
> **Time estimate:** 30–40 minutes  
> **Dependencies:** Part 2 workflow working, Evolution API running

---

## What This Part Adds

Picks up after the Keyword Matcher (Node 6 TRUE branch) and handles:
1. Random delay before replying (anti-ban)
2. Typing indicator simulation (anti-ban)
3. Send the reply via Evolution API
4. Log everything to Google Sheets

---

## Node 7: Wait — Anti-Ban Delay

**Name:** `Wait: Anti-Ban Delay`

| Setting | Value |
|---|---|
| Type | Time Interval |
| Amount | `{{ Math.floor(Math.random() * 7) + 2 }}` |
| Unit | Seconds |

> This produces a random 2–8 second delay before every reply.  
> Never remove this node. It's the primary protection against ban triggers.

---

## Node 8: HTTP Request — Send Reply

**Name:** `HTTP: Send Reply`

| Setting | Value |
|---|---|
| Method | POST |
| URL | `{{ $env.EVOLUTION_API_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}` |
| Authentication | None (header-based) |
| Send Headers | Yes |
| Header 1 Key | `apikey` |
| Header 1 Value | `{{ $env.EVOLUTION_API_KEY }}` |
| Header 2 Key | `Content-Type` |
| Header 2 Value | `application/json` |
| Body Type | JSON |

**Body:**
```json
{
  "number": "{{ $json.phone }}",
  "textMessage": {
    "text": "{{ $json.reply }}"
  },
  "options": {
    "delay": 1500,
    "presence": "composing"
  }
}
```

> `presence: composing` shows the "typing..." indicator to the user before the message arrives.  
> `delay: 1500` = 1.5 seconds of visible typing. Increase to 2500 for longer replies.

### Environment Variables to set in n8n:

Go to n8n Settings → Environment Variables and add:

| Key | Value |
|---|---|
| `EVOLUTION_API_URL` | `http://localhost:8080` (or your Evolution domain) |
| `EVOLUTION_API_KEY` | Your Evolution API key |
| `EVOLUTION_INSTANCE` | Your instance name, e.g. `my-business` |

---

## Node 9: Google Sheets — Append Log

**Name:** `Sheets: Append Log`

| Setting | Value |
|---|---|
| Credential | `Google Sheets - WhatsApp Bot` |
| Operation | Append Row |
| Spreadsheet ID | `YOUR_SPREADSHEET_ID` |
| Sheet Name | `message_log` |

**Column mapping:**

| Column | Value |
|---|---|
| `timestamp` | `{{ $json.received_at }}` |
| `phone` | `{{ $json.phone }}` |
| `message` | `{{ $json.message_text }}` |
| `keyword_matched` | `{{ $json.keyword_matched }}` |
| `reply_sent` | `{{ $json.reply }}` |
| `status` | `replied` |

---

## Complete Workflow Map (All Parts)

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
[Wait: Anti-Ban Delay]  ← 2–8 seconds random
    │
    ▼
[HTTP: Send Reply]  ← Evolution API + composing presence
    │
    ▼
[Sheets: Append Log]
```

---

## Anti-Ban Rules Summary

These are already built into the nodes above. Do not skip any of them:

| Rule | Where it's implemented |
|---|---|
| Random 2–8s delay | Node 7: Wait |
| Typing indicator | Node 8: `presence: composing` |
| Ignore own messages | Node 2: `fromMe === false` |
| Ignore old messages | Node 2: timestamp check (< 60s) |
| Ignore groups | Node 2: `@g.us` filter |
| Ignore no-text messages | Node 2: text content check |

---

## End-to-End Test

1. Send "hello" → expect greeting reply after ~3 seconds with typing indicator
2. Send "سعر" → expect pricing reply
3. Send "gibberish xyz" → expect default fallback reply
4. Check `message_log` sheet — all 3 messages should be logged
5. Check n8n Executions — all 3 runs should be green

---

## Deliverables After This Part

- [ ] Wait node in place with random delay expression
- [ ] HTTP Request node sending correctly to Evolution API
- [ ] Typing indicator visible on phone before reply arrives
- [ ] message_log sheet getting populated after each reply
- [ ] End-to-end test passed for 3+ different keywords
- [ ] Workflow is Active

---

*Next: Part 4 — Deduplication + Volume Protection*
