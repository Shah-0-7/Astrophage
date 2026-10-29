-- Accounts, saved watch rules, and which alerts have already been emailed.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  picture       TEXT NOT NULL DEFAULT '',
  email_alerts  INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_rules (
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- One row per (user, event) already emailed, so an event is never sent twice.
CREATE TABLE IF NOT EXISTS alerts_sent (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id  TEXT NOT NULL,
  sent_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS alerts_sent_at ON alerts_sent (sent_at);
