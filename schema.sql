-- ユーザー（LINEのuserIdがそのまま主キー）
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  budget       INTEGER NOT NULL DEFAULT 0,    -- 月予算（0 = 未設定）
  fix_entry_id INTEGER NOT NULL DEFAULT 0,    -- 「金額を直す」を押した記録。次に数字だけ送るとこの記録の金額を直す
  fix_until    TEXT NOT NULL DEFAULT '',      -- fix_entry_id の期限（ISO 8601）
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
  source     TEXT NOT NULL DEFAULT 'text',    -- 'text' | 'receipt' | 'app' | 'payday'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries (user_id, date);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories (user_id, sort);

-- ---------- シフト収入（既存DBには migrations/ の SQL を番号順に流す） ----------
-- バイト先（シフトはひとつのカレンダーに入れ、予定のタイトルで振り分ける）
CREATE TABLE IF NOT EXISTS shift_jobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  keywords           TEXT NOT NULL DEFAULT '',    -- 予定のタイトルでこのバイト先と判定する言葉（カンマ区切り）。空 = name
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
  income_wall  INTEGER NOT NULL DEFAULT 0,        -- 年間の目安ライン。0 = 表示しない
  ical_url_enc TEXT NOT NULL DEFAULT '',         -- シフトのカレンダーの非公開URL（ICAL_ENCRYPTION_KEYで暗号化）。空 = 未登録
  auto_record  INTEGER NOT NULL DEFAULT 1         -- 給料日・仕送りの日に、見込み額を家計簿へ記録するか
);

-- 給料日・仕送りの日に家計簿へ記録した印。同じ日を二度記録しない（手で消したあとも記録し直さない）
CREATE TABLE IF NOT EXISTS payday_entries (
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('job','allowance')),
  ref_id   INTEGER NOT NULL,                      -- shift_jobs.id または allowances.id
  pay_date TEXT NOT NULL,                         -- 'YYYY-MM-DD'
  entry_id INTEGER NOT NULL DEFAULT 0,            -- 記録した entries.id
  expected INTEGER NOT NULL,                      -- 記録したときの見込み額
  PRIMARY KEY (user_id, kind, ref_id, pay_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_jobs_user ON shift_jobs (user_id, sort);
CREATE INDEX IF NOT EXISTS idx_allowances_user ON allowances (user_id, sort);
