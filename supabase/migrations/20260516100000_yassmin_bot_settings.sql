-- Bot automation limits (dashboard + n8n)

CREATE TABLE IF NOT EXISTS yassmin.bot_settings (
  id text PRIMARY KEY DEFAULT 'default',
  user_cooldown_seconds int NOT NULL DEFAULT 40,
  duplicate_window_seconds int NOT NULL DEFAULT 120,
  user_burst_per_minute int NOT NULL DEFAULT 2,
  global_per_minute_limit int NOT NULL DEFAULT 45,
  daily_message_limit int NOT NULL DEFAULT 300,
  message_max_age_seconds int NOT NULL DEFAULT 300,
  human_handoff_hours int NOT NULL DEFAULT 24,
  log_dedup_blocked boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO yassmin.bot_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE yassmin.bot_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON yassmin.bot_settings TO service_role;
