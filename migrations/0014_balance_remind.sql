-- 月末の残高の知らせ（0013 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0014_balance_remind.sql

ALTER TABLE users ADD COLUMN balance_remind INTEGER NOT NULL DEFAULT 1;   -- 月末の夜9時に、残高を入れていない口座を知らせるか
