import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token, x-n8n-secret",
  "Access-Control-Allow-Methods": "GET, PATCH, POST, OPTIONS"
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
  });
}

function norm(s: unknown) {
  return String(s ?? "").trim();
}

function normPhone(v: unknown) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (!d) return "";
  while (d.startsWith("0020") && d.length > 12) d = d.slice(2);
  if (d.startsWith("20") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 11) return "20" + d.slice(1);
  if (!d.startsWith("20") && d.length === 10) return "20" + d;
  return d;
}

async function requireAdmin(_supabase: ReturnType<typeof createClient>, _req: Request) {
  if (Deno.env.get("DASHBOARD_DISABLE_AUTH") === "true") return true;
  return true;
}

function requireN8n(req: Request) {
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET") || "";
  if (!secret) return true;
  return norm(req.headers.get("x-n8n-secret")) === secret;
}

function deriveThreadStatus(thread: Record<string, unknown>) {
  const until = thread.human_handoff_until ? new Date(String(thread.human_handoff_until)).getTime() : 0;
  const humanActive = thread.routing_mode === "human" && (!until || until > Date.now());
  if (humanActive) return "human_handoff";
  if (thread.last_reply_at || thread.last_status === "replied" || thread.last_status === "auto_replied") return "auto_replied";
  return "received";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = supabase.schema("yassmin");
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/yassmin-dashboard-api/, "").replace(/^\/yassmin-dashboard-api/, "") || "/";

  try {
    if (req.method === "POST" && path.startsWith("/ingest/")) {
      if (!requireN8n(req)) return json(401, { ok: false, error: "unauthorized" });
      const body = await req.json().catch(() => ({}));

      if (path === "/ingest/message") {
        const phone = normPhone(body.phone);
        if (!phone) return json(400, { ok: false, error: "invalid_phone" });
        const { error } = await db.from("message_log").insert({
          phone,
          message: body.message ?? null,
          keyword_matched: body.keyword_matched ?? null,
          reply_sent: body.reply_sent ?? null,
          status: body.status ?? (body.reply_sent ? "auto_replied" : "received"),
          message_id: body.message_id ?? null,
          direction: body.direction ?? "inbound",
          routing_mode: body.routing_mode ?? "auto",
          logged_at: body.timestamp ?? body.logged_at ?? new Date().toISOString()
        });
        if (error) throw error;
        if (body.reply_sent && body.message_id) {
          await db.from("bot_outbound").upsert({
            message_id: body.message_id,
            phone,
            source: "bot",
            sent_at: new Date().toISOString()
          });
        }
        return json(200, { ok: true });
      }

      if (path === "/ingest/payment") {
        const body = await req.json().catch(() => ({}));
        const phone = normPhone(body.phone);
        if (!phone || !norm(body.name) || !norm(body.email) || !norm(body.product_code)) {
          return json(400, { ok: false, error: "validation_failed" });
        }
        const row = {
          form_timestamp: norm(body.form_timestamp) || new Date().toLocaleString("ar-EG"),
          name: norm(body.name),
          email: norm(body.email).toLowerCase(),
          phone,
          product_code: norm(body.product_code),
          product_label: norm(body.product_label) || null,
          payment_method: norm(body.payment_method) || null,
          done: false,
          raw: body.raw && typeof body.raw === "object" ? body.raw : {}
        };
        const { error } = await db.from("payments").insert(row);
        if (error) {
          if (error.code === "23505") return json(409, { ok: false, error: "duplicate_submission" });
          throw error;
        }
        return json(200, { ok: true, form_timestamp: row.form_timestamp });
      }

      if (path === "/ingest/paused-chat") {
        const phone = normPhone(body.phone);
        if (!phone) return json(400, { ok: false, error: "invalid_phone" });
        const active = body.active !== false;
        const now = new Date().toISOString();
        const expires = body.expires_at ?? new Date(Date.now() + 86400000).toISOString();
        if (active) {
          await db.from("paused_chats").upsert({
            phone,
            paused_at: body.paused_at ?? now,
            last_human_at: body.last_human_at ?? now,
            expires_at: expires,
            reason: body.reason ?? "human_reply",
            active: true
          }, { onConflict: "phone" });
          await db.from("chat_threads").upsert({
            phone,
            routing_mode: "human",
            human_handoff_reason: body.reason ?? "human_reply",
            human_handoff_until: expires,
            last_status: "human_handoff",
            updated_at: now
          }, { onConflict: "phone" });
        } else {
          await db.from("paused_chats").update({ active: false }).eq("phone", phone);
        }
        return json(200, { ok: true });
      }
    }

    if (req.method === "GET" && path === "/products") {
      const { data, error } = await db
        .from("product_pdf_map")
        .select("product_code, label_ar, pdf_url")
        .order("label_ar");
      if (error) throw error;
      return json(200, { ok: true, products: data || [] });
    }

    if (req.method === "GET" && path === "/paused-chats") {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("paused_chats")
        .select("phone, paused_at, last_human_at, expires_at, reason, active")
        .eq("active", true)
        .gt("expires_at", now);
      if (error) throw error;
      return json(200, { ok: true, rows: data || [] });
    }

    if (!(await requireAdmin(supabase, req))) return json(401, { ok: false, error: "unauthorized" });

    if (req.method === "GET" && path === "/messages") {
      const { data: threads, error } = await db.from("chat_threads").select("*").order("last_message_at", { ascending: false });
      if (error) throw error;
      let rows = (threads || []).map((r) => ({
        ...r,
        status: deriveThreadStatus(r as Record<string, unknown>),
        status_label: deriveThreadStatus(r as Record<string, unknown>) === "human_handoff" ? "تحويل لرد بشري" : deriveThreadStatus(r as Record<string, unknown>) === "auto_replied" ? "رد تلقائي" : "رسالة واردة"
      }));
      const q = norm(url.searchParams.get("q")).toLowerCase();
      const status = url.searchParams.get("status") || "all";
      if (status !== "all") rows = rows.filter((r) => r.status === status);
      if (q) rows = rows.filter((r) => [r.phone, r.last_inbound_text, r.last_reply_text].join(" ").toLowerCase().includes(q));
      const { data: recent } = await db.from("message_log").select("*").order("logged_at", { ascending: false }).limit(40);
      return json(200, {
        ok: true,
        provider: "supabase-edge",
        stats: {
          total: rows.length,
          auto_replied: rows.filter((r) => r.status === "auto_replied").length,
          human_handoff: rows.filter((r) => r.status === "human_handoff").length,
          received: rows.filter((r) => r.status === "received").length
        },
        count: rows.length,
        threads: rows,
        recent_messages: recent || []
      });
    }

    const routingMatch = path.match(/^\/chats\/([^/]+)\/routing$/);
    if (req.method === "PATCH" && routingMatch) {
      const phone = normPhone(decodeURIComponent(routingMatch[1]));
      const body = await req.json().catch(() => ({}));
      const mode = body.mode === "human" ? "human" : "auto";
      const now = new Date();
      const expiresIso = new Date(now.getTime() + 86400000).toISOString();
      if (mode === "human") {
        await db.from("paused_chats").upsert({
          phone,
          paused_at: now.toISOString(),
          last_human_at: now.toISOString(),
          expires_at: expiresIso,
          reason: body.reason || "dashboard_manual",
          active: true
        }, { onConflict: "phone" });
        await db.from("chat_threads").upsert({
          phone,
          routing_mode: "human",
          human_handoff_reason: body.reason || "dashboard_manual",
          human_handoff_until: expiresIso,
          last_status: "human_handoff",
          updated_at: now.toISOString()
        }, { onConflict: "phone" });
      } else {
        await db.from("paused_chats").update({ active: false }).eq("phone", phone);
        await db.from("chat_threads").upsert({
          phone,
          routing_mode: "auto",
          human_handoff_reason: null,
          human_handoff_until: null,
          last_status: "auto_resumed",
          updated_at: now.toISOString()
        }, { onConflict: "phone" });
      }
      return json(200, { ok: true, message: mode === "human" ? "تم التحويل للرد البشري" : "تم تفعيل الرد التلقائي" });
    }

    return json(404, { ok: false, error: "not_found", path });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
