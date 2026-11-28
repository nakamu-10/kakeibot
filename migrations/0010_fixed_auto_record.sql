-- 固定費を払う日に家計簿へ自動で記録する（0009 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0010_fixed_auto_record.sql

ALTER TABLE fixed_costs ADD COLUMN auto_record INTEGER NOT NULL DEFAULT 1;    -- 1 なら払う日の朝に記録する
ALTER TABLE fixed_costs ADD COLUMN last_recorded TEXT NOT NULL DEFAULT '';    -- 最後に自動で記録した日（同じ日に2回記録しない）
