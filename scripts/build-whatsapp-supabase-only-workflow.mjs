/**
 * يحدّث whatsapp-bot-yassmin-supabase-only.json (المصدر الوحيد للبوت في الريبو).
 * اختياري: عيّني YASSMIN_DASHBOARD_API_BASE لاستبدال عنوان yassmin-dashboard-api في كل عُقد HTTP.
 * مثال: YASSMIN_DASHBOARD_API_BASE=https://xxxx.supabase.co/functions/v1/yassmin-dashboard-api
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, "whatsapp-bot-yassmin-supabase-only.json");

const wf = JSON.parse(fs.readFileSync(outPath, "utf8"));
const baseRaw = process.env.YASSMIN_DASHBOARD_API_BASE || "";
const base = baseRaw.replace(/\/+$/, "");

function patchUrls(x) {
  if (typeof x === "string") {
    if (!base) return x;
    return x.replace(
      /https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/yassmin-dashboard-api/g,
      base
    );
  }
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) x[i] = patchUrls(x[i]);
    return x;
  }
  if (x && typeof x === "object") {
    for (const k of Object.keys(x)) x[k] = patchUrls(x[k]);
  }
  return x;
}

patchUrls(wf);
fs.writeFileSync(outPath, JSON.stringify(wf, null, 2));
console.log("Wrote", outPath, base ? `(patched dashboard API → ${base})` : "(no URL env; reformatted only)");
