-- 記録を直した回数（0005 のあとに1回だけ流す）。外の AI が使い方から改善案を出すため
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0006_edit_count.sql

ALTER TABLE entries ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;
