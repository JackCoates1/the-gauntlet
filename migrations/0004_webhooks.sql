CREATE TABLE IF NOT EXISTS webhooks (
  url TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
