import type { Env } from '../types';
import type { Repo } from '../db';
import { buildReport, jstMidnight } from './calc';
import { fetchHolidays } from './holidays';
import { parseEvents, rangeForYear, type CalendarEvent, type Range } from './ical';
import { assignJobs } from './match';
import { decryptText } from './secret';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_UNMATCHED = 10;

export type ShiftReport = Awaited<ReturnType<typeof loadReport>>;

/**
 * カレンダーと祝日を読み、月のレポートを作る（LIFF・トーク・給料日の通知で共通）。
 * カレンダーが読めなければ errors に理由を入れ、仕送りなどだけで計算を続ける
 */
export async function loadReport(
  env: Pick<Env, 'ICAL_ENCRYPTION_KEY'>,
  repo: Repo,
  userId: string,
  year: number,
  month: number,
  nowMs: number,
) {
  const [jobs, allowances, settings, holidays] = await Promise.all([
    repo.shiftJobs(userId),
    repo.allowances(userId),
    repo.shiftSettings(userId),
    fetchHolidays([year - 1, year]),
  ]);
  const errors: string[] = [];
  let events: CalendarEvent[] = [];
  if (jobs.length) {
    try {
      events = await readCalendar(env, settings.icalUrlEnc, rangeForYear(year));
    } catch (e) {
      // URL が混ざらないよう、ログには理由だけ出す
      console.error('shift calendar failed', e instanceof Error ? e.message : e);
      errors.push(e instanceof CalendarError ? e.message : 'カレンダーを読めませんでした');
    }
  }
  const { shifts, unmatched } = assignJobs(events, jobs);
  const report = buildReport({ jobs, allowances, wall: settings.wall }, shifts, holidays, year, month, nowMs);

  // その月の予定のうち、どのバイト先にも当てはまらなかったもの（タイトルの書き忘れに気づけるように）
  const monthStart = jstMidnight(year, month, 1);
  const monthEnd = jstMidnight(year, month + 1, 1);
  const unmatchedTitles = [
    ...new Set(
      unmatched.filter((e) => e.start >= monthStart && e.start < monthEnd).map((e) => e.title || '（タイトルなし）'),
    ),
  ].slice(0, MAX_UNMATCHED);

  return { ...report, errors, unmatchedTitles, hasJobs: jobs.length > 0, hasCalendar: settings.icalUrlEnc !== '' };
}

/** ユーザーに見せてよい理由のエラー */
class CalendarError extends Error {}

async function readCalendar(
  env: Pick<Env, 'ICAL_ENCRYPTION_KEY'>,
  icalUrlEnc: string,
  range: Range,
): Promise<CalendarEvent[]> {
  if (!icalUrlEnc)
    throw new CalendarError('シフトのカレンダーが未登録です。設定でカレンダーのアドレスを貼ってください');
  const icalUrl = await decryptText(env.ICAL_ENCRYPTION_KEY, icalUrlEnc);
  const res = await fetch(icalUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 404 || res.status === 403) {
    throw new CalendarError('カレンダーが見つかりません。非公開アドレスをリセットした場合は、設定で貼り直してください');
  }
  if (!res.ok) throw new CalendarError(`カレンダーを読めませんでした（${res.status}）`);
  return parseEvents(await res.text(), range);
}
