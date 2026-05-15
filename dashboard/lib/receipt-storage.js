const BUCKET = 'receipts';
const MAX_BYTES = 5 * 1024 * 1024;

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

function decodeBase64(b64) {
  return Buffer.from(String(b64), 'base64');
}

async function uploadReceipt(supabase, { phone, base64, mime }) {
  if (!base64) return null;
  const buf = decodeBase64(base64);
  if (buf.length > MAX_BYTES) {
    const err = new Error('receipt_too_large');
    err.code = 'VALIDATION';
    throw err;
  }
  const safePhone = String(phone || 'unknown').replace(/\D/g, '') || 'unknown';
  const objectPath = `${safePhone}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(mime)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buf, {
    contentType: mime || 'application/octet-stream',
    upsert: false,
    cacheControl: '3600'
  });

  if (error) {
    const err = new Error(error.message || 'receipt_upload_failed');
    err.code = 'STORAGE';
    throw err;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

module.exports = { uploadReceipt, BUCKET, MAX_BYTES };
