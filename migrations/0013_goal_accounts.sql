-- 目標と口座をつなぐ（0012 のあとに1回だけ流す）。つないだら、今貯まっている額は口座の残高の合計にする
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0013_goal_accounts.sql

ALTER TABLE goals ADD COLUMN account_ids TEXT NOT NULL DEFAULT '[]';   -- accounts.id の JSON 配列
