import type { Env } from '../types';
import { Repo } from '../db';
import { liffUrl, push, qrPostback, qrUri, text, type LineMessage } from '../line';
import { todayJST } from '../util';
import type { SalaryIncoming } from './calc';
import { loadReport } from './report';
import { incomingOn, paydayText, paysOn, salaryMemo } from './text';

/**
 * 給料日・仕送りの日の処理（Cron から毎朝呼ぶ）。
 * 見込み額を家計簿に収入として記録し（設定でオフにできる）、給料日なら通知する
 */
export async function runPaydays(env: Env, now: Date): Promise<void> {
  const repo = new Repo(env.DB);
  const today = todayJST(now);
  const [y, m] = today.split('-').map(Number);
  for (const userId of await repo.usersWithShiftIncome()) {
    try {
      const [jobs, allowances, settings] = await Promise.all([
        repo.shiftJobs(userId),
        repo.allowances(userId),
        repo.shiftSettings(userId),
      ]);
      // カレンダーを読むのは、今日が給料日か仕送りの日の人だけ
      const due = jobs.some((j) => paysOn(j.payDay, today)) || allowances.some((a) => paysOn(a.day, today));
      if (!due) continue;
      const report = await loadReport(env, repo, userId, y, m, now.getTime());
      const { salaries, allowances: sent } = incomingOn(report, today);

      if (!settings.autoRecord) {
        if (salaries.length) await notify(env, userId, salaries, [], report.errors);
        continue;
      }
      const recorded: { pay: SalaryIncoming; entryId: number }[] = [];
      for (const pay of salaries) {
        const entryId = await repo.recordPayday(userId, {
          kind: 'job',
          refId: pay.jobId,
          payDate: today,
          amount: pay.total,
          category: '給与',
          memo: salaryMemo(pay),
        });
        if (entryId) recorded.push({ pay, entryId });
      }
      // 仕送りは日付も金額も決まっているので、記録だけして通知しない
      for (const a of sent) {
        await repo.recordPayday(userId, {
          kind: 'allowance',
          refId: a.allowanceId,
          payDate: today,
          amount: a.total,
          category: '仕送り',
          memo: a.name,
        });
      }
      // 記録済み（同じ日に2回動いたなど）の給与は、もう一度は知らせない
      if (recorded.length) {
        await notify(
          env,
          userId,
          recorded.map((r) => r.pay),
          recorded.map((r) => qrPostback(`${r.pay.name}の金額を直す`, `action=fixamt&id=${r.entryId}`, '金額を直す')),
          report.errors,
        );
      }
    } catch (e) {
      // 1人の失敗で、ほかの人への処理を止めない
      console.error('payday failed', e instanceof Error ? e.message : e);
    }
  }
}

async function notify(
  env: Env,
  userId: string,
  salaries: SalaryIncoming[],
  fixButtons: LineMessage[],
  errors: string[],
): Promise<void> {
  const message = paydayText(salaries, fixButtons.length > 0, errors);
  await push(env, userId, [text(message, [...fixButtons, qrUri('シフト収入', liffUrl(env, '/shift'))])]);
}
