# WhatsApp Auto-Reply Bot - Client Handover

## Project Status
The WhatsApp bot is live and working with:
- Incoming message reception from Evolution API
- Keyword-based automatic replies
- Logging to Google Sheets
- Anti-ban protections (rate limit + deduplication)
- **Email-based lead capture** — automatically collects contacts who share their email

## Connected Services
- `n8n` (workflow engine)
- `Evolution API` (WhatsApp gateway)
- `Google Sheets` (keywords, logs, and email leads)

## Main Data Source
Spreadsheet:
`https://docs.google.com/spreadsheets/d/1frBgjb61hrUrWdErjgK74wkStcF6nx2-uNfIb6ILlnY`

Sheets used:
- `keywords` — editable reply rules
- `message_log` — automatic reply audit log
- `email_leads` — **automatically built lead list** (used for email follow-up workflow)

## How Replies Work
1. User sends a WhatsApp message.
2. Bot checks keyword rules in `keywords`.
3. Bot picks the best matching reply.
4. Bot sends the reply via Evolution API.
5. Bot logs the transaction in `message_log`.

## How Email Leads Are Captured
After every successful reply, the bot automatically:
1. Scans the message text for an email address.
2. If an email is found → saves a row in `email_leads` with:
   - Contact email, phone, name (if mentioned), intent type, message text, timestamp.
3. If the same email sends again → updates their row (no duplicate rows — email is the unique key).
4. If no email is found → silently continues, nothing added to `email_leads`.

This sheet is ready to feed the next workflow (email campaign / follow-up automation).

## Intent Types (Auto-Classified)
The bot classifies each message into one of these categories automatically:

| Intent | What it means |
|---|---|
| `free_gifts` | Asking for free gifts/resources |
| `paid_products` | Asking about paid digital products |
| `planner_order` | Ordering the professional planner |
| `full_bundle` | Ordering the full rescue bundle |
| `free_consultation` | Booking a free team consultation |
| `private_consultation` | Booking a private session with Yassmin |
| `other` | Doesn't match any known pattern |

## Protection Rules (Anti-Ban)
- Ignore invalid/old/group/non-text events
- Random reply delay
- Duplicate protection by `message_id`
- Duplicate text protection window
- Per-user cooldown
- Per-user burst cap per minute
- Global cap per minute
- Daily cap

## What to Edit (Business Team)
Only edit `keywords` sheet:
- `keyword`: trigger words (comma-separated)
- `reply`: message sent to user
- `active`: `TRUE` / `FALSE`

Keep a `default` keyword row for fallback replies.

**Do not edit `message_log` or `email_leads` manually** — they are written by the automation.

## Operations Notes
- If a reply is not sent, check n8n execution logs first.
- If Evolution instance name changes, update send endpoint instance path.
- Do not use manager URL for API calls; use API endpoint base URL only.
- The `email_leads` sheet must exist before the workflow runs — created by `setup-google-sheets.js`.

## Delivered Files
- `whatsapp-bot-n8n-workflow.json`
- `setup-google-sheets.js` (run once to create all sheet tabs + headers)
- `README.md` (technical documentation)
- `README-Client.md` (this handover summary)
