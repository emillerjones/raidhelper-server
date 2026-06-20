DROP TABLE IF EXISTS raidhelper_events; --No current dependencies


CREATE TABLE raidhelper_events (
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