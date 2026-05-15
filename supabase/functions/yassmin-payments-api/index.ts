import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
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

function deriveStatus(row: Record<string, unknown>) {
  const done = Boolean(row.done);
  const wa = norm(row.whatsapp_status).toLowerCase();
  const dead = Boolean(row.dead_letter) || wa === "dead_letter";
  if (dead) return "dead_letter";
  if (wa === "sent") return "sent";
  if (wa === "failed") return "failed";
  if (done && !wa) return "awaiting_whatsapp";
  if (done) return "confirmed";
  return "pending_review";
}

function mapRow(row: Record<string, unknown>) {
  const raw = (row.raw as Record<string, unknown>) || {};
  const mapped = {
    id: norm(row.form_timestamp),
    timestamp: norm(row.form_timestamp),
    name: norm(row.name),
    email: norm(row.email),
    phone: norm(row.phone),
    product_code: norm(row.product_code),
    product_label: norm(row.product_label),
    payment_method: norm(row.payment_method),
    done: Boolean(row.done),
    whatsapp_status: norm(row.whatsapp_status),
    whatsapp_last_error: norm(row.whatsapp_last_error),
    whatsapp_sent_at: row.whatsapp_sent_at ? String(row.whatsapp_sent_at) : "",
    receipt_url:
      norm(row.receipt_url) ||
      norm(raw["رفع صوره الايصال"]) ||
      norm(raw["رفع صوره الايصال "]) ||
      "",
    status: ""
  };
  mapped.status = deriveStatus({ ...row, ...mapped });
  return mapped;
}

function summarize(rows: ReturnType<typeof mapRow>[]) {
  const stats = {
    total: rows.length,
    pending_review: 0,
    awaiting_whatsapp: 0,
    sent: 0,
    failed: 0,
    dead_letter: 0,
    confirmed_other: 0
  };
  for (const row of rows) {
    if (row.status === "pending_review") stats.pending_review += 1;
    else if (row.status === "awaiting_whatsapp") stats.awaiting_whatsapp += 1;
    else if (row.status === "sent") stats.sent += 1;
    else if (row.status === "failed") stats.failed += 1;
    else if (row.status === "dead_letter") stats.dead_letter += 1;
    else stats.confirmed_other += 1;
  }
  return stats;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = supabase.schema("yassmin");
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/yassmin-payments-api/, "")
    .replace(/^\/yassmin-payments-api/, "") || "/";

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

    if (req.method === "GET" && path === "/products") {
      const { data, error } = await db
        .from("product_pdf_map")
        .select("product_code, label_ar, pdf_url")
        .order("label_ar");
      if (error) throw error;
      return json(200, { ok: true, products: data || [] });
    }

    if (req.method === "GET" && (path === "/" || path === "")) {
      const { data, error } = await db.from("payments").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      let rows = (data || []).map((r) => mapRow(r as Record<string, unknown>));
      const q = norm(url.searchParams.get("q")).toLowerCase();
      const status = url.searchParams.get("status") || "all";
      if (status !== "all") rows = rows.filter((r) => r.status === status);
      if (q) {
        rows = rows.filter((r) =>
          [r.timestamp, r.name, r.email, r.phone, r.product_code, r.product_label]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }
      const all = (data || []).map((r) => mapRow(r as Record<string, unknown>));
      return json(200, {
        ok: true,
        provider: "supabase-edge",
        schema: "yassmin",
        stats: summarize(all),
        count: rows.length,
        rows
      });
    }

    const patchMatch = path.match(/^\/([^/]+)$/);
    if (req.method === "PATCH" && patchMatch) {
      const key = decodeURIComponent(patchMatch[1]);
      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = { done: body.done === true };
      if (!body.done && body.resetWhatsapp !== false) {
        patch.whatsapp_status = null;
        patch.whatsapp_last_error = null;
        patch.whatsapp_sent_at = null;
      }
      const { data, error } = await db
        .from("payments")
        .update(patch)
        .eq("form_timestamp", key)
        .select("form_timestamp")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(404, { ok: false, error: "payment_row_not_found" });

      const { data: all } = await db.from("payments").select("*").order("created_at", { ascending: false });
      const rows = (all || []).map((r) => mapRow(r as Record<string, unknown>));
      return json(200, {
        ok: true,
        provider: "supabase-edge",
        stats: summarize(rows),
        rows
      });
    }

    return json(404, { ok: false, error: "not_found", path });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
