-- 固定費・サブスク（0008 のあとに1回だけ流す）。登録するだけで、家計簿には自動で記録しない
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0009_fixed_costs.sql

CREATE TABLE IF NOT EXISTS fixed_costs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  category   TEXT NOT NULL,                     -- 支出のカテゴリ名
  cycle      TEXT NOT NULL DEFAULT 'monthly',   -- 'monthly' | 'yearly'
  day        INTEGER NOT NULL DEFAULT 1,        -- 払う日（31 = 月末）
  month      INTEGER NOT NULL DEFAULT 0,        -- 毎年のとき払う月。毎月なら 0
  active     INTEGER NOT NULL DEFAULT 1,        -- やめたら 0（記録として残す）
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fixed_costs_user ON fixed_costs (user_id);
