-- シフトをひとつのカレンダーにまとめ、予定のタイトルでバイト先に振り分ける（0001 のあとに1回だけ流す）
-- npx wrangler d1 execute kakeibo --remote --file=migrations/0002_shift_one_calendar.sql
-- 登録済みのURLは、各ユーザーの1つ目のバイト先のものをカレンダーとして引き継ぐ

ALTER TABLE shift_settings ADD COLUMN ical_url_enc TEXT NOT NULL DEFAULT '';
ALTER TABLE shift_jobs ADD COLUMN keywords TEXT NOT NULL DEFAULT '';

INSERT INTO shift_settings (user_id) SELECT DISTINCT user_id FROM shift_jobs WHERE true
  ON CONFLICT (user_id) DO NOTHING;
UPDATE shift_settings SET ical_url_enc = COALESCE((
  SELECT j.ical_url_enc FROM shift_jobs j
  WHERE j.user_id = shift_settings.user_id AND j.ical_url_enc != ''
  ORDER BY j.sort, j.id LIMIT 1
), '');

ALTER TABLE shift_jobs DROP COLUMN ical_url_enc;
