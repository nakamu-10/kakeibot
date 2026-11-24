-- ユーザー（LINEのuserIdがそのまま主キー）
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  budget     INTEGER NOT NULL DEFAULT 0,      -- 月予算（0 = 未設定）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- カテゴリ（ユーザーごとに追加・削除・並び替え可能）
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('expense','income')),
  sort     INTEGER NOT NULL DEFAULT 0,
  keywords TEXT NOT NULL DEFAULT '',          -- カンマ区切り。「ランチ」→食費 のような自動判定用
  UNIQUE (user_id, name)
);

-- 収支の記録
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('expense','income')),
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  memo       TEXT NOT NULL DEFAULT '',
  store      TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL,                   -- 'YYYY-MM-DD'（日本時間）
  source     TEXT NOT NULL DEFAULT 'text',    -- 'text' | 'receipt' | 'app'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries (user_id, date);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories (user_id, sort);
