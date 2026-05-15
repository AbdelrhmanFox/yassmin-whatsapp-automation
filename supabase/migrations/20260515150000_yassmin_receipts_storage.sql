-- إيصالات الدفع: عمود URL + bucket تخزين عام للقراءة

ALTER TABLE yassmin.payments
  ADD COLUMN IF NOT EXISTS receipt_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY IF NOT EXISTS receipts_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'receipts');
