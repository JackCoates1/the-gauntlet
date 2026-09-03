CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  agent_label TEXT,
  user_agent TEXT,
  score INTEGER,
  total INTEGER,
  scorecard_json TEXT
);
ALTER TABLE runs ADD COLUMN sig TEXT;
CREATE TABLE IF NOT EXISTS webhooks (
  url TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run_id ON events(run_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_key_ts ON rate_limits(key, ts);
