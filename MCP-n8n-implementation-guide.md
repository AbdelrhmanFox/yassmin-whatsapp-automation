# n8n MCP Implementation Guide (Self-Hosted)

## Cursor MCP — المكدس الكامل (نسخ جاهز)

هذا المشروع يوفّر قالب Cursor في **`.cursor/mcp.json.example`**. انسخيه إلى **`~/.cursor/mcp.json`** (عالمي) أو **`[المشروع]/.cursor/mcp.json`** ثم عدّلي القيم:

| السيرفر | المطلوب | المراجع |
|--------|---------|---------|
| **vercel** | OAuth من Cursor عند أول اتصال | [Vercel MCP](https://vercel.com/docs/mcp/vercel-mcp) — أو سطر واحد: `npx add-mcp https://mcp.vercel.com` |
| **supabase** | استبدلي `YOUR_SUPABASE_PROJECT_REF` (مثال المشروع الحالي: `elcofahsbznfalrbjmfo`) وتسجيل الدخول من Cursor | [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) — للإنتاج فكّري `read_only=true` في الـ URL |
| **n8n** | من n8n: *Settings → Instance-level MCP*، انسخي الـ token ومسار `/mcp-server/http` | نفس الدومين المستضيف: `https://n8n.growleadpro.com` |

**اختياري — توثيق المكتبات في Cursor:** أضيفي [Context7 MCP](https://context7.com) من إعدادات Cursor إن كان متاحاً لديكم.

بعد الحفظ: **Cursor → Settings → Tools & MCP** → تأكدي أن كل سيرفر متصل (Needs login → تسجيل الدخول).

---

This guide implements the selected plan for using MCP with n8n in this project.

## Recommended Architecture

- Primary: n8n built-in MCP (`Instance-level MCP` + `MCP Server Trigger` / `MCP Client Tool`)
- Optional enhancement: `czlonkowski/n8n-mcp` as a second MCP server for workflow-building assistance

## Step 1 - Enable Instance-Level MCP

1. Open n8n as admin.
2. Go to `Settings -> Instance-level MCP`.
3. Enable `MCP access`.
4. Open `Connection details`.
5. Generate and copy an `Access Token` for PoC use.

Use this endpoint format:

- `https://<your-n8n-domain>/mcp-server/http`

## Step 2 - Expose Only Required Workflow

Production uses **one** workflow file: import **`full-whatsapp-bot-yassmin-workflow.json`**, then expose that workflow (name e.g. **FULL WhatsApp BOT Yassmin**) to MCP — not the standalone payment JSON export.

In workflow editor:
1. Open workflow menu (`...`).
2. Open `Settings`.
3. Enable `Available in MCP`.
4. Add clear description so MCP clients can identify it quickly.

## Step 3 - Connect MCP Client

### Cursor / Codex-style TOML config

```toml
[mcp_servers.n8n_mcp]
url = "https://<your-n8n-domain>/mcp-server/http"
http_headers = { "authorization" = "Bearer <YOUR_N8N_MCP_TOKEN>" }
```

### Claude Desktop JSON config

```json
{
  "mcpServers": {
    "n8n-local": {
      "type": "http",
      "url": "https://<your-n8n-domain>/mcp-server/http",
      "headers": {
        "Authorization": "Bearer <YOUR_N8N_MCP_TOKEN>"
      }
    }
  }
}
```

## Step 4 - PoC Validation Scenarios

Run these 3 tests before broad rollout:

1. Discover workflow
   - From MCP client, list/search workflows.
   - Expected: payment confirmation workflow appears.

2. Safe execution
   - Trigger a controlled test execution.
   - Expected: execution succeeds and updates sheet status correctly.

3. Minimal update
   - Perform a small non-breaking edit (for example message text).
   - Validate with test execution.
   - Expected: updated behavior with no regression.

## Step 5 - Optional AI Build Booster (`czlonkowski/n8n-mcp`)

Use only when you need stronger AI support for:

- Node/template discovery
- Workflow validation before deployment
- Faster generation of complex workflow structures

Do not replace built-in n8n MCP with this. Run both if needed.

## Step 6 - Security and Rollout Checklist

- Keep MCP exposure limited to approved workflows only.
- Use dedicated token for MCP and rotate it periodically.
- Revoke token immediately if leaked.
- If behind reverse proxy, ensure MCP/SSE/streamable HTTP routes are correctly configured.
- Do not store API secrets directly in workflow JSON.
- Use environment variables for secrets (already applied for Evolution API key in payment workflow).

## Project-Specific Secret Requirement

Set this variable in the n8n runtime environment:

- `EVOLUTION_API_KEY=<your_real_evolution_api_key>`

The payment workflow now reads this key from:

- `{{$env.EVOLUTION_API_KEY}}`
