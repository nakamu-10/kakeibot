-- 記録忘れ通知（0003 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0004_remind.sql

ALTER TABLE users ADD COLUMN remind INTEGER NOT NULL DEFAULT 0;
