-- Yassmin WhatsApp automation (schema: yassmin)
-- Apply via Supabase CLI or Dashboard SQL editor.

CREATE SCHEMA IF NOT EXISTS yassmin;

CREATE TABLE yassmin.keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  reply text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE yassmin.message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at timestamptz NOT NULL DEFAULT now(),
  phone text NOT NULL,
  message text,
  keyword_matched text,
  reply_sent text,
  status text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_log_phone_idx ON yassmin.message_log (phone);
CREATE INDEX message_log_message_id_idx ON yassmin.message_log (message_id);

CREATE TABLE yassmin.email_leads (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  phone text,
  name_hint text,
  intent_type text,
  latest_message text,
  message_id text,
  source text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'new'
);

CREATE TABLE yassmin.paused_chats (
  phone text PRIMARY KEY,
  paused_at timestamptz NOT NULL DEFAULT now(),
  last_human_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reason text,
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX paused_chats_active_expires_idx ON yassmin.paused_chats (active, expires_at);

CREATE TABLE yassmin.bot_outbound (
  message_id text PRIMARY KEY,
  phone text NOT NULL,
  source text NOT NULL DEFAULT 'bot',
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bot_outbound_phone_idx ON yassmin.bot_outbound (phone);

CREATE TABLE yassmin.product_pdf_map (
  product_code text PRIMARY KEY,
  pdf_url text NOT NULL,
  label_ar text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE yassmin.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_timestamp text NOT NULL UNIQUE,
  name text,
  email text,
  phone text,
  product_code text,
  product_label text,
  payment_method text,
  done boolean NOT NULL DEFAULT false,
  whatsapp_status text,
  whatsapp_last_error text,
  whatsapp_sent_at timestamptz,
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  next_retry_at timestamptz,
  locked_at timestamptz,
  lock_owner text,
  dead_letter boolean NOT NULL DEFAULT false,
  last_http_status int,
  event_type text,
  stage text,
  result text,
  error_code text,
  latency_ms int,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_done_idx ON yassmin.payments (done);
CREATE INDEX payments_whatsapp_status_idx ON yassmin.payments (whatsapp_status);
CREATE INDEX payments_created_at_idx ON yassmin.payments (created_at DESC);

CREATE OR REPLACE FUNCTION yassmin.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON yassmin.payments
  FOR EACH ROW EXECUTE FUNCTION yassmin.set_updated_at();

CREATE TRIGGER keywords_updated_at
  BEFORE UPDATE ON yassmin.keywords
  FOR EACH ROW EXECUTE FUNCTION yassmin.set_updated_at();

INSERT INTO yassmin.keywords (keyword, reply, active, sort_order) VALUES
  ('hello, hi, مرحبا, أهلاً, أهلا, هاي', '👋 Hello! How can we help you today? Reply with *price*, *location*, or *hours*.', true, 1),
  ('price, prices, سعر, الأسعار, بكام, كام', '💰 Our pricing:\n- Service A: $50\n- Service B: $80\nReply to book!', true, 2),
  ('location, address, عنوان, فين, وين', '📍 Address: 123 Main St\nGoogle Maps: https://maps.app.goo.gl/YOURLINK', true, 3),
  ('hours, working hours, مواعيد, ساعات, امتى', '🕐 Working hours: Sat–Thu, 9am–6pm. Fri: closed.', true, 4),
  ('human, agent, موظف, كلمني, واحد', '👤 Got it! A team member will reach out shortly. Please hold. 🙏', true, 5),
  ('default', '😊 Sorry, didn''t catch that! Reply with:\n*price* 💰 *location* 📍 *hours* 🕐', true, 99);

INSERT INTO yassmin.product_pdf_map (product_code, pdf_url, label_ar) VALUES
  ('voltaren_social', 'https://drive.google.com/file/d/REPLACE_VOLTAREN/view?usp=sharing', 'فولتارين السوشيال ميديا'),
  ('inner_compass', 'https://drive.google.com/file/d/REPLACE_COMPASS/view?usp=sharing', 'بوصلتك الداخلية')
ON CONFLICT (product_code) DO NOTHING;

ALTER TABLE yassmin.keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.email_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.paused_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.bot_outbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.product_pdf_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE yassmin.payments ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA yassmin TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA yassmin TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA yassmin TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA yassmin GRANT ALL ON TABLES TO service_role;
