import type { Env } from '../types';
import type { Repo } from '../db';
import { json, monthOf, todayJST } from '../util';
import { sanitizeAllowance, sanitizeJob } from './calc';
import { loadReport } from './report';
import { encryptText, isGoogleIcalUrl } from './secret';

const MAX_JOBS = 10;
const MAX_ALLOWANCES = 10;

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
    // 空なら今の URL を残す（画面には URL を返していないため）
    const icalUrl = typeof body.icalUrl === 'string' ? body.icalUrl.trim() : '';
    if (icalUrl && !isGoogleIcalUrl(icalUrl)) {
      return json({ error: 'Google カレンダーの「iCal 形式の非公開アドレス」を貼ってください' }, 400);
    }
    if (icalUrl && !env.ICAL_ENCRYPTION_KEY) {
      return json({ error: 'サーバーに ICAL_ENCRYPTION_KEY が設定されていません' }, 500);
    }
    const jobs = (Array.isArray(body.jobs) ? body.jobs.slice(0, MAX_JOBS) : [])
      .map(sanitizeJob)
      .map((j) => ({ ...j, name: j.name.slice(0, 20), keywords: j.keywords.slice(0, 100) }));
    const allowances = (Array.isArray(body.allowances) ? body.allowances.slice(0, MAX_ALLOWANCES) : [])
      .map(sanitizeAllowance)
      .map((a) => ({ ...a, name: a.name.slice(0, 20) }));
    await repo.saveShiftSettings(userId, {
      jobs,
      allowances,
      wall: Math.max(0, Math.round(Number(body.wall) || 0)),
      icalUrlEnc: icalUrl ? await encryptText(env.ICAL_ENCRYPTION_KEY, icalUrl) : null,
    });
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
  const [jobs, allowances, settings] = await Promise.all([
    repo.shiftJobs(userId),
    repo.allowances(userId),
    repo.shiftSettings(userId),
  ]);
  return { jobs, allowances, wall: settings.wall, hasIcal: settings.icalUrlEnc !== '' };
}
