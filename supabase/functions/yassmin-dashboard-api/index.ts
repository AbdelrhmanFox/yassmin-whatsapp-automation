import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token, x-n8n-secret",
  "Access-Control-Allow-Methods": "GET, PATCH, POST, DELETE, OPTIONS"
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

function requireDashboardWrite(req: Request): boolean {
  const need = norm(Deno.env.get("DASHBOARD_ADMIN_TOKEN") || "");
  if (!need) return true;
  return norm(req.headers.get("x-admin-token")) === need;
}

function requireN8n(req: Request) {
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET") || "";
  if (!secret) return true;
  if (norm(req.headers.get("x-n8n-secret")) === secret) return true;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const auth = req.headers.get("authorization") || "";
  const apikey = norm(req.headers.get("apikey"));
  if (anon && norm(auth) === `Bearer ${anon}`) return true;
  if (anon && apikey === anon) return true;
  return false;
}

function extFromMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

async function uploadReceipt(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  base64: string,
  mime: string
) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bin.length > 5 * 1024 * 1024) throw new Error("receipt_too_large");
  const safePhone = phone.replace(/\D/g, "") || "unknown";
  const objectPath = `${safePhone}/${Date.now()}.${extFromMime(mime || "image/jpeg")}`;
  const { error } = await supabase.storage.from("receipts").upload(objectPath, bin, {
    contentType: mime || "application/octet-stream",
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from("receipts").getPublicUrl(objectPath);
  return data.publicUrl;
}

function deriveThreadStatus(thread: Record<string, unknown>) {
  const until = thread.human_handoff_until ? new Date(String(thread.human_handoff_until)).getTime() : 0;
  const humanActive = thread.routing_mode === "human" && (!until || until > Date.now());
  if (humanActive) return "human_handoff";
  if (thread.last_status === "human_handoff_skipped" || thread.last_status === "paused_skipped") {
    return "human_handoff";
  }
  if (thread.last_reply_at || thread.last_status === "replied" || thread.last_status === "auto_replied") {
    return "auto_replied";
  }
  return "received";
}

function threadsFromMessageLog(logs: Record<string, unknown>[]) {
  if (!logs.length) return [];
  const sorted = [...logs].sort(
    (a, b) => new Date(String(a.logged_at)).getTime() - new Date(String(b.logged_at)).getTime()
  );
  const byPhone = new Map<string, Record<string, unknown>>();
  for (const row of sorted) {
    const phone = normPhone(row.phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) {
      byPhone.set(phone, {
        phone,
        last_message_at: row.logged_at,
        last_inbound_text: "",
        last_inbound_at: null,
        last_reply_text: "",
        last_reply_at: null,
        last_keyword: "",
        routing_mode: "auto",
        message_count: 0,
        last_status: null,
        human_handoff_until: null,
        human_handoff_reason: null
      });
    }
    const t = byPhone.get(phone)!;
    t.message_count = Number(t.message_count) + 1;
    t.last_message_at = row.logged_at;
    const msg = norm(row.message);
    const reply = norm(row.reply_sent);
    if (msg) {
      t.last_inbound_text = msg;
      t.last_inbound_at = row.logged_at;
    }
    if (reply) {
      t.last_reply_text = reply;
      t.last_reply_at = row.logged_at;
    }
    if (row.keyword_matched) t.last_keyword = row.keyword_matched;
    if (row.status) t.last_status = row.status;
    if (row.routing_mode) t.routing_mode = row.routing_mode;
  }
  return Array.from(byPhone.values()).sort(
    (a, b) =>
      new Date(String(b.last_message_at)).getTime() - new Date(String(a.last_message_at)).getTime()
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = supabase.schema("yassmin");
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/yassmin-dashboard-api/, "").replace(/^\/yassmin-dashboard-api/, "") || "/";

  try {
    if (req.method === "POST" && path === "/ingest/payment") {
      const body = await req.json().catch(() => ({}));
      const phone = normPhone(body.phone);
      if (!phone || !norm(body.name) || !norm(body.email) || !norm(body.product_code)) {
        return json(400, { ok: false, error: "validation_failed" });
      }
      let receipt_url = norm(body.receipt_url);
      if (!receipt_url && !body.receipt_base64) {
        return json(400, { ok: false, error: "receipt_required" });
      }
      if (!receipt_url && body.receipt_base64) {
        try {
          receipt_url = await uploadReceipt(
            supabase,
            phone,
            String(body.receipt_base64),
            norm(body.receipt_mime) || "image/jpeg"
          );
        } catch (e) {
          return json(400, {
            ok: false,
            error: e instanceof Error ? e.message : "receipt_upload_failed"
          });
        }
      }
      const raw: Record<string, unknown> =
        body.raw && typeof body.raw === "object" ? { ...body.raw } : {};
      if (receipt_url) raw["رفع صوره الايصال"] = receipt_url;
      delete raw.receipt_base64;

      const row = {
        form_timestamp: norm(body.form_timestamp) || new Date().toLocaleString("ar-EG"),
        name: norm(body.name),
        email: norm(body.email).toLowerCase(),
        phone,
        product_code: norm(body.product_code),
        product_label: norm(body.product_label) || null,
        payment_method: norm(body.payment_method) || null,
        receipt_url: receipt_url || null,
        done: false,
        raw
      };
      const { error } = await db.from("payments").insert(row);
      if (error) {
        if (error.code === "23505") return json(409, { ok: false, error: "duplicate_submission" });
        return json(500, { ok: false, error: error.message, code: error.code });
      }
      return json(200, { ok: true, form_timestamp: row.form_timestamp, receipt_url });
    }

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

    if (req.method === "GET" && path === "/keywords") {
      const { data, error } = await db
        .from("keywords")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json(200, { ok: true, keywords: data || [] });
    }

    if (req.method === "POST" && path === "/keywords") {
      if (!requireDashboardWrite(req)) return json(401, { ok: false, error: "unauthorized" });
      const body = await req.json().catch(() => ({}));
      const keyword = norm(body.keyword);
      const reply = norm(body.reply);
      if (!keyword || !reply) return json(400, { ok: false, error: "keyword_and_reply_required" });
      const row = {
        keyword,
        reply,
        active: body.active !== false,
        sort_order: Number(body.sort_order) || 0,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await db.from("keywords").insert(row).select("*").single();
      if (error) throw error;
      return json(201, { ok: true, keyword: data });
    }

    const kwPatch = path.match(/^\/keywords\/([^/]+)$/);
    if (kwPatch && req.method === "PATCH") {
      if (!requireDashboardWrite(req)) return json(401, { ok: false, error: "unauthorized" });
      const id = decodeURIComponent(kwPatch[1]);
      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.keyword !== undefined) patch.keyword = norm(body.keyword);
      if (body.reply !== undefined) patch.reply = norm(body.reply);
      if (body.active !== undefined) patch.active = body.active === true;
      if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
      if (Object.keys(patch).length <= 1) return json(400, { ok: false, error: "empty_patch" });
      const { data, error } = await db.from("keywords").update(patch).eq("id", id).select("*").maybeSingle();
      if (error) throw error;
      if (!data) return json(404, { ok: false, error: "not_found" });
      return json(200, { ok: true, keyword: data });
    }

    if (kwPatch && req.method === "DELETE") {
      if (!requireDashboardWrite(req)) return json(401, { ok: false, error: "unauthorized" });
      const id = decodeURIComponent(kwPatch[1]);
      const { data: deleted, error } = await db.from("keywords").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!deleted?.length) return json(404, { ok: false, error: "not_found" });
      return json(200, { ok: true, deleted: id });
    }

    if (!(await requireAdmin(supabase, req))) return json(401, { ok: false, error: "unauthorized" });

    if (req.method === "GET" && path === "/messages") {
      const { data: threads, error } = await db.from("chat_threads").select("*").order("last_message_at", { ascending: false });
      if (error) throw error;
      const mapThreadRow = (r: Record<string, unknown>) => {
        const st = deriveThreadStatus(r);
        return {
          ...r,
          status: st,
          status_label:
            st === "human_handoff" ? "تحويل لرد بشري" : st === "auto_replied" ? "رد تلقائي" : "رسالة واردة"
        };
      };
      let rows = (threads || []).map((r) => mapThreadRow(r as Record<string, unknown>));
      if (!threads || threads.length === 0) {
        const { data: logForThreads, error: logErr } = await db
          .from("message_log")
          .select("*")
          .order("logged_at", { ascending: false })
          .limit(500);
        if (logErr) throw logErr;
        const synthetic = threadsFromMessageLog((logForThreads || []) as Record<string, unknown>[]);
        if (synthetic.length) rows = synthetic.map((r) => mapThreadRow(r));
      }
      const q = norm(url.searchParams.get("q")).toLowerCase();
      const status = url.searchParams.get("status") || "all";
      if (status !== "all") rows = rows.filter((r) => r.status === status);
      if (q) {
        rows = rows.filter((r) =>
          [r.phone, r.last_inbound_text, r.last_reply_text, r.last_keyword]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }
      const { data: recent } = await db.from("message_log").select("*").order("logged_at", { ascending: false }).limit(60);
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

    if (req.method === "GET" && path === "/messages/thread") {
      const phone = normPhone(url.searchParams.get("phone"));
      if (!phone) return json(400, { ok: false, error: "invalid_phone" });
      const { data, error } = await db
        .from("message_log")
        .select("*")
        .eq("phone", phone)
        .order("logged_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return json(200, { ok: true, phone, messages: data || [] });
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
