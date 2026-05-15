-- Chat threads aggregate + message_log v2 columns for dashboard

ALTER TABLE yassmin.message_log
  ADD COLUMN IF NOT EXISTS direction text DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS routing_mode text DEFAULT 'auto';

CREATE TABLE IF NOT EXISTS yassmin.chat_threads (
  phone text PRIMARY KEY,
  last_message_at timestamptz,
  last_inbound_text text,
  last_inbound_at timestamptz,
  last_reply_text text,
  last_reply_at timestamptz,
  last_keyword text,
  routing_mode text NOT NULL DEFAULT 'auto',
  human_handoff_reason text,
  human_handoff_until timestamptz,
  message_count int NOT NULL DEFAULT 0,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_last_message_at_idx
  ON yassmin.chat_threads (last_message_at DESC);

CREATE OR REPLACE FUNCTION yassmin.message_log_upsert_thread()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO yassmin.chat_threads (phone, updated_at)
  VALUES (NEW.phone, now())
  ON CONFLICT (phone) DO NOTHING;

  UPDATE yassmin.chat_threads SET
    message_count = message_count + 1,
    last_message_at = COALESCE(NEW.logged_at, now()),
    last_inbound_text = CASE WHEN COALESCE(NEW.direction, 'inbound') = 'inbound' THEN NEW.message ELSE last_inbound_text END,
    last_inbound_at = CASE WHEN COALESCE(NEW.direction, 'inbound') = 'inbound' THEN COALESCE(NEW.logged_at, now()) ELSE last_inbound_at END,
    last_reply_text = CASE WHEN NEW.reply_sent IS NOT NULL AND NEW.reply_sent <> '' THEN NEW.reply_sent ELSE last_reply_text END,
    last_reply_at = CASE WHEN NEW.reply_sent IS NOT NULL AND NEW.reply_sent <> '' THEN COALESCE(NEW.logged_at, now()) ELSE last_reply_at END,
    last_keyword = COALESCE(NEW.keyword_matched, last_keyword),
    last_status = COALESCE(NEW.status, last_status),
    routing_mode = COALESCE(NEW.routing_mode, routing_mode),
    updated_at = now()
  WHERE phone = NEW.phone;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_log_upsert_thread ON yassmin.message_log;
CREATE TRIGGER message_log_upsert_thread
  AFTER INSERT ON yassmin.message_log
  FOR EACH ROW EXECUTE FUNCTION yassmin.message_log_upsert_thread();

ALTER TABLE yassmin.chat_threads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON yassmin.chat_threads TO service_role;
