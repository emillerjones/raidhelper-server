-- DROP TABLE IF EXISTS raidhelper_events; --No current dependencies


CREATE TABLE IF NOT EXISTS raidhelper_events (
  raidhelper_event_id SERIAL PRIMARY KEY,

  event_id TEXT UNIQUE,
  softres_id TEXT,
  guild_id TEXT,
  guild_name TEXT,
  guild_icon_url TEXT,
  channel_id TEXT,

  raid_name TEXT,
  raid_notes TEXT,
  raid_leader TEXT,


  title TEXT,
  start_time TIMESTAMP,
  signup_count INTEGER,
  signup_max INTEGER,

  raidhelper_url TEXT,
  softres_url TEXT,
  raw_json JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_visits (
  calendar_visit_id SERIAL PRIMARY KEY,

  visitor_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referer TEXT,
  route TEXT,
  page TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Existing databases already have this table from before "page" existed;
-- CREATE TABLE IF NOT EXISTS above is a no-op for them, so add it here too.
ALTER TABLE calendar_visits ADD COLUMN IF NOT EXISTS page TEXT;

CREATE INDEX IF NOT EXISTS calendar_visits_visitor_id_idx
ON calendar_visits (visitor_id);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('extension_telemetry_enabled', 'true'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS extension_scan_runs (
  extension_scan_run_id SERIAL PRIMARY KEY,

  extension_install_id TEXT NOT NULL,
  extension_version TEXT,
  scan_type TEXT NOT NULL,
  scan_mode TEXT,
  status TEXT NOT NULL DEFAULT 'started',

  guild_id TEXT,
  guild_name TEXT,
  channel_id TEXT,

  server_count INTEGER,
  raids_found INTEGER,
  raids_imported INTEGER,
  raids_updated INTEGER,
  raids_failed INTEGER,
  duration_ms INTEGER,

  error_code TEXT,
  error_message TEXT,

  user_agent TEXT,
  route TEXT,

  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CHECK (status IN ('started', 'completed', 'failed', 'abandoned')),
  CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 10800000)),
  CHECK (server_count IS NULL OR (server_count >= 0 AND server_count <= 1000)),
  CHECK (raids_found IS NULL OR (raids_found >= 0 AND raids_found <= 10000)),
  CHECK (raids_imported IS NULL OR (raids_imported >= 0 AND raids_imported <= 10000)),
  CHECK (raids_updated IS NULL OR (raids_updated >= 0 AND raids_updated <= 10000)),
  CHECK (raids_failed IS NULL OR (raids_failed >= 0 AND raids_failed <= 10000))
);

CREATE INDEX IF NOT EXISTS extension_scan_runs_install_id_idx
ON extension_scan_runs (extension_install_id);

CREATE INDEX IF NOT EXISTS extension_scan_runs_started_at_idx
ON extension_scan_runs (started_at);
