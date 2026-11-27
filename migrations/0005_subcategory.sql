-- カテゴリの親子（2段まで）（0004 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0005_subcategory.sql

ALTER TABLE categories ADD COLUMN parent_id INTEGER NOT NULL DEFAULT 0;
