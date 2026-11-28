-- 貯金の目標（0010 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0011_goals.sql

CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  target     INTEGER NOT NULL,                  -- 目標の額
  saved      INTEGER NOT NULL DEFAULT 0,        -- 今貯まっている額（ユーザーか AI が入れる）
  deadline   TEXT NOT NULL DEFAULT '',          -- 'YYYY-MM'。なければ ''
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id);
