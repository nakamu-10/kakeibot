import type { Env } from '../types';
import type { Repo, StoredJob } from '../db';
import { json, monthOf, todayJST } from '../util';
import { buildReport, sanitizeAllowance, sanitizeJob, type RawShift } from './calc';
import { fetchHolidays } from './holidays';
import { parseShifts, rangeForYear } from './ical';
import { decryptText, encryptText, isGoogleIcalUrl } from './secret';

const MAX_JOBS = 10;
const MAX_ALLOWANCES = 10;
const FETCH_TIMEOUT_MS = 10_000;

/** LIFF のシフト収入ページから呼ばれる API（/api/shift/...）。本人確認は api.ts で済んでいる */
export async function handleShiftApi(
  env: Env,
  repo: Repo,
  userId: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
  url: URL,
): Promise<Response> {
  if (method === 'GET' && path === '/shift/settings') return json(await settingsForClient(repo, userId));

  if (method === 'PUT' && path === '/shift/settings') {
    const rawJobs = Array.isArray(body.jobs) ? body.jobs.slice(0, MAX_JOBS) : [];
    const jobs = [];
    for (const raw of rawJobs) {
      const job = sanitizeJob(raw);
      job.name = job.name.slice(0, 20);
      const icalUrl =
        typeof (raw as { icalUrl?: unknown }).icalUrl === 'string' ? (raw as { icalUrl: string }).icalUrl.trim() : '';
      if (icalUrl && !isGoogleIcalUrl(icalUrl)) {
        return json({ error: `${job.name}：Google カレンダーの「iCal 形式の非公開URL」を貼ってください` }, 400);
      }
      if (icalUrl && !env.ICAL_ENCRYPTION_KEY) {
        return json({ error: 'サーバーに ICAL_ENCRYPTION_KEY が設定されていません' }, 500);
      }
      // 空なら今の URL を残す（画面には URL を返していないため）
      jobs.push({ job, icalUrlEnc: icalUrl ? await encryptText(env.ICAL_ENCRYPTION_KEY, icalUrl) : null });
    }
    const allowances = (Array.isArray(body.allowances) ? body.allowances.slice(0, MAX_ALLOWANCES) : [])
      .map(sanitizeAllowance)
      .map((a) => ({ ...a, name: a.name.slice(0, 20) }));
    const wall = Math.max(0, Math.round(Number(body.wall) || 0));
    await repo.saveShiftSettings(userId, jobs, allowances, wall);
    return json(await settingsForClient(repo, userId));
  }

  if (method === 'GET' && path === '/shift/report') {
    const q = url.searchParams.get('month') ?? '';
    const month = /^\d{4}-\d{2}$/.test(q) ? q : monthOf(todayJST());
    const [year, m] = month.split('-').map(Number);
    return json({ today: todayJST(), ...(await loadReport(env, repo, userId, year, m, Date.now())) });
  }

  return json({ error: 'not found' }, 404);
}

/** 画面に返す設定。非公開URLは返さず、登録済みかどうかだけ伝える */
async function settingsForClient(repo: Repo, userId: string) {
  const [jobs, allowances, wall] = await Promise.all([
    repo.shiftJobs(userId),
    repo.allowances(userId),
    repo.incomeWall(userId),
  ]);
  return { jobs: jobs.map(({ icalUrlEnc, ...j }) => ({ ...j, hasIcal: icalUrlEnc !== '' })), allowances, wall };
}

/** カレンダーと祝日を読み、月のレポートを作る。読めなかったバイト先は errors に入れて続ける */
async function loadReport(env: Env, repo: Repo, userId: string, year: number, month: number, nowMs: number) {
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

async function readJobShifts(env: Env, job: StoredJob, range: { from: number; to: number }): Promise<RawShift[]> {
  if (!job.icalUrlEnc) throw new CalendarError('カレンダーのURLが未登録です');
  const icalUrl = await decryptText(env.ICAL_ENCRYPTION_KEY, job.icalUrlEnc);
  const res = await fetch(icalUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 404 || res.status === 403) {
    throw new CalendarError('カレンダーが見つかりません。非公開URLをリセットした場合は、設定で貼り直してください');
  }
  if (!res.ok) throw new CalendarError(`カレンダーを読めませんでした（${res.status}）`);
  return parseShifts(await res.text(), job.id, range);
}
