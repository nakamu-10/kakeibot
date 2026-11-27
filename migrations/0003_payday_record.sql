-- 給料日・仕送りの日に見込み額を家計簿へ記録する（0002 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0003_payday_record.sql

CREATE TABLE IF NOT EXISTS payday_entries (
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('job','allowance')),
  ref_id   INTEGER NOT NULL,
  pay_date TEXT NOT NULL,
  entry_id INTEGER NOT NULL DEFAULT 0,
  expected INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id, pay_date)
);

ALTER TABLE shift_settings ADD COLUMN auto_record INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN fix_entry_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN fix_until TEXT NOT NULL DEFAULT '';
