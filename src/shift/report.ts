import type { Env } from '../types';
import type { Repo, StoredJob } from '../db';
import { buildReport, type RawShift } from './calc';
import { fetchHolidays } from './holidays';
import { parseShifts, rangeForYear, type Range } from './ical';
import { decryptText } from './secret';

const FETCH_TIMEOUT_MS = 10_000;

export type ShiftReport = Awaited<ReturnType<typeof loadReport>>;

/** カレンダーと祝日を読み、月のレポートを作る（LIFF・トーク・給料日の通知で共通）。読めなかったバイト先は errors に入れて続ける */
export async function loadReport(env: Env, repo: Repo, userId: string, year: number, month: number, nowMs: number) {
  const [jobs, allowances, wall, holidays] = await Promise.all([
    repo.shiftJobs(userId),
    repo.allowances(userId),
    repo.incomeWall(userId),
    fetchHolidays([year - 1, year]),
  ]);
  const errors: string[] = [];
  const range = rangeForYear(year);
  const perJob = await Promise.all(
    jobs.map(async (job) => {
      try {
        return await readJobShifts(env, job, range);
      } catch (e) {
        // URL が混ざらないよう、ログにはバイト先の id と理由だけ出す
        console.error('shift calendar failed', job.id, e instanceof Error ? e.message : e);
        errors.push(`${job.name}：${e instanceof CalendarError ? e.message : 'カレンダーを読めませんでした'}`);
        return [];
      }
    }),
  );
  const report = buildReport({ jobs, allowances, wall }, perJob.flat(), holidays, year, month, nowMs);
  return { ...report, errors, hasJobs: jobs.length > 0 };
}

/** ユーザーに見せてよい理由のエラー */
class CalendarError extends Error {}

async function readJobShifts(env: Env, job: StoredJob, range: Range): Promise<RawShift[]> {
  if (!job.icalUrlEnc) throw new CalendarError('カレンダーのURLが未登録です');
  const icalUrl = await decryptText(env.ICAL_ENCRYPTION_KEY, job.icalUrlEnc);
  const res = await fetch(icalUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 404 || res.status === 403) {
    throw new CalendarError('カレンダーが見つかりません。非公開URLをリセットした場合は、設定で貼り直してください');
  }
  if (!res.ok) throw new CalendarError(`カレンダーを読めませんでした（${res.status}）`);
  return parseShifts(await res.text(), job.id, range);
}
