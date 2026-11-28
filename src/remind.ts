import type { Env } from './types';
import { Repo } from './db';
import { liffUrl, push, qrCamera, qrMessage, qrUri, text } from './line';
import { daysInMonth, jstDayStartUtc, monthOf, todayJST } from './util';

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

export function balanceRemindText(names: string[]): string {
  return `今月の残高を入れましょう。まだの口座：${names.join('、')}\n家計簿の「資産」から入れるか、AI に伝えてください。`;
}

/** 月末の残高の知らせ（記録忘れ通知と同じ Cron）。月末の日だけ、今月の残高をまだ入れていない口座がある人に送る */
export async function runBalanceReminders(env: Env, now: Date): Promise<void> {
  const today = todayJST(now);
  const month = monthOf(today);
  if (Number(today.slice(8, 10)) !== daysInMonth(month)) return;
  const byUser = new Map<string, string[]>();
  for (const { userId, name } of await new Repo(env.DB).accountsMissingBalance(month)) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), name]);
  }
  for (const [userId, names] of byUser) {
    await push(env, userId, [text(balanceRemindText(names), [qrUri('残高を入れる', liffUrl(env, '?tab=assets'))])]);
  }
}
