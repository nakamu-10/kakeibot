-- 資産と借金（0011 のあとに1回だけ流す）。口座ごとに、月に1回の残高を入れる
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0012_assets.sql

CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'savings',   -- 'savings' | 'nisa' | 'ideco' | 'securities' | 'crypto' | 'other' | 'debt'
  active     INTEGER NOT NULL DEFAULT 1,        -- 解約したら 0（これまでの残高は残す）
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);

CREATE TABLE IF NOT EXISTS balances (
  account_id   INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  month        TEXT NOT NULL,                   -- 'YYYY-MM'
  balance      INTEGER NOT NULL,                -- 借金は返していない額を正の数で
  contribution INTEGER NOT NULL DEFAULT 0,      -- その月に入れた額（投資の口座だけ）
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, month)
);

CREATE INDEX IF NOT EXISTS idx_balances_user ON balances (user_id, month);
