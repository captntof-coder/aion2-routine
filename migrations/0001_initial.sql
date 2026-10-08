-- AION 2 Routine : SQLite / Cloudflare D1
-- Chaque ligne est rattachée au user_id de la session Discord validée côté Worker.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  item_id TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category, period, item_id)
);
CREATE INDEX IF NOT EXISTS progress_period_idx ON progress(user_id, period);
