import type { Env } from './types';
import { Repo } from './db';
import { push, qrCamera, qrMessage, text } from './line';
import { jstDayStartUtc, todayJST } from './util';

const REMIND_TEXT =
  '今日はまだ記録がありません。「ランチ 800」のように送るか、レシートの写真を送ってください。\n何件かあるときは、改行してまとめて送れます。';

/** 記録忘れ通知（Cron から毎晩呼ぶ）。オンにしていて、今日まだ1件も記録していない人に送る */
export async function runReminders(env: Env, now: Date): Promise<void> {
  const repo = new Repo(env.DB);
  const users = await repo.usersToRemind(jstDayStartUtc(todayJST(now)));
  for (const userId of users) {
    // 1人の失敗で、ほかの人への通知を止めない（push は失敗をログに出すだけで例外を出さない）
    await push(env, userId, [text(REMIND_TEXT, [qrCamera(), qrMessage('今月')])]);
  }
}
