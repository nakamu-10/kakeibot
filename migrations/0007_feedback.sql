-- 外の AI から送られた、アプリへの要望（0006 のあとに1回だけ流す）。リポジトリが公開なので Issue には直接作らない
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0007_feedback.sql

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')), -- 持ち主が見たら 'done'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id, created_at);
