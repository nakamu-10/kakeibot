-- カテゴリ別予算（ADR 0017）
CREATE TABLE IF NOT EXISTS category_budgets (
  user_id       TEXT NOT NULL,
  category_name TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  PRIMARY KEY (user_id, category_name)
);
