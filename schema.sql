-- ユーザー（LINEのuserIdがそのまま主キー）
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  budget     INTEGER NOT NULL DEFAULT 0,      -- 月予算（0 = 未設定）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- カテゴリ（ユーザーごとに追加・削除・並び替え可能）
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('expense','income')),
  sort     INTEGER NOT NULL DEFAULT 0,
  keywords TEXT NOT NULL DEFAULT '',          -- カンマ区切り。「ランチ」→食費 のような自動判定用
  UNIQUE (user_id, name)
);

-- 収支の記録
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('expense','income')),
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  memo       TEXT NOT NULL DEFAULT '',
  store      TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL,                   -- 'YYYY-MM-DD'（日本時間）
  source     TEXT NOT NULL DEFAULT 'text',    -- 'text' | 'receipt' | 'app'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries (user_id, date);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories (user_id, sort);

-- ---------- シフト収入（既存DBには migrations/0001_shift_income.sql を流す） ----------
-- バイト先（1行 = Google カレンダー1つ）
CREATE TABLE IF NOT EXISTS shift_jobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  ical_url_enc       TEXT NOT NULL DEFAULT '',    -- iCalの非公開URL（ICAL_ENCRYPTION_KEYで暗号化）。空 = 未登録
  weekday_rate       INTEGER NOT NULL DEFAULT 0,
  weekend_rate       INTEGER NOT NULL DEFAULT 0,  -- 0 = 平日と同じ
  holiday_as_weekend INTEGER NOT NULL DEFAULT 0,
  night_enabled      INTEGER NOT NULL DEFAULT 0,
  night_premium      INTEGER NOT NULL DEFAULT 25, -- %
  breaks             TEXT NOT NULL DEFAULT '[]',  -- [{"overHours":6,"minutes":45}]
  round_unit         INTEGER NOT NULL DEFAULT 1,  -- 分
  transport          INTEGER NOT NULL DEFAULT 0,  -- 1出勤日あたり
  closing_day        INTEGER NOT NULL DEFAULT 31, -- 31 = 末日
  pay_month_offset   INTEGER NOT NULL DEFAULT 1,  -- 0 当月 / 1 翌月 / 2 翌々月
  pay_day            INTEGER NOT NULL DEFAULT 25, -- 31 = 末日
  sort               INTEGER NOT NULL DEFAULT 0
);

-- 毎月決まった収入（仕送りなど）
CREATE TABLE IF NOT EXISTS allowances (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  amount  INTEGER NOT NULL,
  day     INTEGER NOT NULL,                       -- 毎月何日。31 = 末日
  sort    INTEGER NOT NULL DEFAULT 0
);

-- シフト収入のユーザー設定
CREATE TABLE IF NOT EXISTS shift_settings (
  user_id     TEXT PRIMARY KEY,
  income_wall INTEGER NOT NULL DEFAULT 0          -- 年間の目安ライン。0 = 表示しない
);

CREATE INDEX IF NOT EXISTS idx_shift_jobs_user ON shift_jobs (user_id, sort);
CREATE INDEX IF NOT EXISTS idx_allowances_user ON allowances (user_id, sort);
