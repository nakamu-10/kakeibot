import type { Env } from '../types';
import { Repo } from '../db';
import { liffUrl, push, qrUri, text } from '../line';
import { todayJST } from '../util';
import { loadReport } from './report';
import { jobsPayingOn, paydayText } from './text';

/** 今日が給料日の人に、見込み額を送る（Cron から毎朝呼ぶ） */
export async function notifyPaydays(env: Env, now: Date): Promise<void> {
  const repo = new Repo(env.DB);
  const today = todayJST(now);
  const [y, m] = today.split('-').map(Number);
  for (const userId of await repo.usersWithShiftJobs()) {
    try {
      // カレンダーを読むのは、今日が給料日のバイト先がある人だけ
      if (!jobsPayingOn(await repo.shiftJobs(userId), today).length) continue;
      const message = paydayText(await loadReport(env, repo, userId, y, m, now.getTime()), today);
      if (message) await push(env, userId, [text(message, [qrUri('シフト収入', liffUrl(env, '/shift'))])]);
    } catch (e) {
      // 1人の失敗で、ほかの人への通知を止めない
      console.error('payday notify failed', e instanceof Error ? e.message : e);
    }
  }
}
