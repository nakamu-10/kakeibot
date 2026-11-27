-- AI による変更の履歴と取り消し（0007 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0008_changes.sql

CREATE TABLE IF NOT EXISTS changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  batch      TEXT NOT NULL,                     -- 1回の依頼（ツールの1回の呼び出し）。取り消しはこの単位
  target     TEXT NOT NULL,                     -- 'entry' | 'budget'（段階ごとに増える）
  target_id  INTEGER NOT NULL DEFAULT 0,
  op         TEXT NOT NULL,                     -- 'insert' | 'update' | 'delete'
  before     TEXT NOT NULL DEFAULT 'null',      -- JSON
  after      TEXT NOT NULL DEFAULT 'null',      -- JSON
  summary    TEXT NOT NULL DEFAULT '',          -- 「追加：食費 ¥800（11/27 ランチ）」
  undone     INTEGER NOT NULL DEFAULT 0,        -- 取り消したら 1
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_changes_user ON changes (user_id, id);
