-- 貯金・投資のカテゴリ（0014 のあとに1回だけ流す）。支出には数えず、別に出す
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0015_saving.sql

ALTER TABLE categories ADD COLUMN saving INTEGER NOT NULL DEFAULT 0;   -- 1 なら、使ったお金ではなく貯金・投資に移したお金

-- 今のユーザーにも「貯金・投資」を足す。同じ名前のカテゴリがあれば、それに印を付ける
INSERT OR IGNORE INTO categories (user_id, name, type, sort, keywords, saving)
  SELECT u.id, '貯金・投資', 'expense',
         (SELECT COALESCE(MAX(c.sort), -1) + 1 FROM categories c WHERE c.user_id = u.id),
         '積立,nisa,ideco,貯金,投資', 1
  FROM users u;
UPDATE categories SET saving = 1 WHERE name = '貯金・投資' AND type = 'expense';
