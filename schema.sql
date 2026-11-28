-- ユーザー（LINEのuserIdがそのまま主キー）
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  budget       INTEGER NOT NULL DEFAULT 0,    -- 月予算（0 = 未設定）
  fix_entry_id INTEGER NOT NULL DEFAULT 0,    -- 「金額を直す」を押した記録。次に数字だけ送るとこの記録の金額を直す
  fix_until    TEXT NOT NULL DEFAULT '',      -- fix_entry_id の期限（ISO 8601）
  remind       INTEGER NOT NULL DEFAULT 0,    -- 記録忘れ通知（毎晩21時）を送るか
  balance_remind INTEGER NOT NULL DEFAULT 1,  -- 月末の夜9時に、残高を入れていない口座を知らせるか
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
  parent_id INTEGER NOT NULL DEFAULT 0,       -- 親カテゴリの id（0 = 一番上の段）。2段まで
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
  source     TEXT NOT NULL DEFAULT 'text',    -- 'text' | 'receipt' | 'app' | 'payday' | 'ai' | 'fixed'
  edit_count INTEGER NOT NULL DEFAULT 0,      -- 記録を直した回数（使い方から改善案を出すため）
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

-- 外の AI から送られた、アプリへの要望（持ち主が見て Issue にするかを決める）
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')), -- 持ち主が見たら 'done'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id, created_at);

-- AI による変更の履歴と取り消し
CREATE TABLE IF NOT EXISTS changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  batch      TEXT NOT NULL,                     -- 1回の依頼（ツールの1回の呼び出し）。取り消しはこの単位
  target     TEXT NOT NULL,                     -- 'entry' | 'budget'（段階ごとに増える）
  target_id  INTEGER NOT NULL DEFAULT 0,
  op         TEXT NOT NULL,                     -- 'insert' | 'update' | 'delete'
  before     TEXT NOT NULL DEFAULT 'null',      -- JSON
  after      TEXT NOT NULL DEFAULT 'null',      -- JSON
  summary    TEXT NOT NULL DEFAULT '',          -- 「追加：食費 ¥800（11/27 ランチ）」
  undone     INTEGER NOT NULL DEFAULT 0,        -- 取り消したら 1
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_changes_user ON changes (user_id, id);

-- 固定費・サブスク
CREATE TABLE IF NOT EXISTS fixed_costs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  category   TEXT NOT NULL,                     -- 支出のカテゴリ名
  cycle      TEXT NOT NULL DEFAULT 'monthly',   -- 'monthly' | 'yearly'
  day        INTEGER NOT NULL DEFAULT 1,        -- 払う日（31 = 月末）
  month      INTEGER NOT NULL DEFAULT 0,        -- 毎年のとき払う月。毎月なら 0
  active     INTEGER NOT NULL DEFAULT 1,        -- やめたら 0（記録として残す）
  auto_record INTEGER NOT NULL DEFAULT 1,       -- 1 なら払う日の朝に家計簿へ記録する
  last_recorded TEXT NOT NULL DEFAULT '',       -- 最後に自動で記録した日（同じ日に2回記録しない）
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fixed_costs_user ON fixed_costs (user_id);

-- 貯金の目標
CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  target     INTEGER NOT NULL,                  -- 目標の額
  saved      INTEGER NOT NULL DEFAULT 0,        -- 今貯まっている額（ユーザーか AI が入れる）
  deadline   TEXT NOT NULL DEFAULT '',          -- 'YYYY-MM'。なければ ''
  account_ids TEXT NOT NULL DEFAULT '[]',       -- つないだ口座（accounts.id の JSON 配列）。あれば saved の代わりに残高の合計を使う
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id);

-- 資産と借金（口座ごとに、月に1回の残高）
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'savings',   -- 'savings' | 'nisa' | 'ideco' | 'securities' | 'crypto' | 'other' | 'debt'
  active     INTEGER NOT NULL DEFAULT 1,        -- 解約したら 0（これまでの残高は残す）
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);

CREATE TABLE IF NOT EXISTS balances (
  account_id   INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  month        TEXT NOT NULL,                   -- 'YYYY-MM'
  balance      INTEGER NOT NULL,                -- 借金は返していない額を正の数で
  contribution INTEGER NOT NULL DEFAULT 0,      -- その月に入れた額（投資の口座だけ）
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, month)
);

CREATE INDEX IF NOT EXISTS idx_balances_user ON balances (user_id, month);
