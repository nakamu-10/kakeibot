import { yen } from '../util';
import type { AllowanceIncoming, SalaryIncoming } from './calc';
import type { ShiftReport } from './report';

/** 'YYYY-MM-DD' → '11/25' */
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`;
}

/** トークの「収入」への返信：その月の入金予定 */
export function incomingText(r: ShiftReport): string {
  const lines = [`${r.year}年${r.month}月の入金予定`, ''];
  if (!r.hasJobs && !r.incoming.length) {
    return 'シフト収入はまだ設定されていません。下の「シフト収入」から、バイト先とカレンダーを登録してください。';
  }
  if (!r.incoming.length) lines.push('この月の入金予定はありません。');
  for (const p of r.incoming) {
    lines.push(`${md(p.payDate)} ${p.name} ${yen(p.total)}`);
    if (p.type === 'salary') {
      const transport = p.transport ? `・うち交通費 ${yen(p.transport)}` : '';
      lines.push(`  ${md(p.periodStart)}〜${md(p.periodEnd)}分・${p.count}回・${hours(p.workMin)}${transport}`);
    }
  }
  if (r.incoming.length) lines.push('', `合計 ${yen(r.incomingTotal)}`);
  if (r.errors.length) lines.push('', ...r.errors);
  return lines.join('\n');
}

/** その日に入る給与と仕送り */
export function incomingOn(
  r: ShiftReport,
  date: string,
): { salaries: SalaryIncoming[]; allowances: AllowanceIncoming[] } {
  const today = r.incoming.filter((p) => p.payDate === date);
  return {
    salaries: today.flatMap((p) => (p.type === 'salary' ? [p] : [])),
    allowances: today.flatMap((p) => (p.type === 'allowance' ? [p] : [])),
  };
}

/** 家計簿のメモ：「珈琲館 10/1〜10/31分」 */
export const salaryMemo = (p: SalaryIncoming) => `${p.name} ${md(p.periodStart)}〜${md(p.periodEnd)}分`;

/** 給料日の朝の通知。recorded なら家計簿に記録したことも伝える */
export function paydayText(salaries: SalaryIncoming[], recorded: boolean, errors: string[]): string {
  const lines = salaries.map(
    (p) => `今日は${p.name}の給料日です。見込み ${yen(p.total)}（${md(p.periodStart)}〜${md(p.periodEnd)}分）`,
  );
  if (recorded) {
    lines.push('', '家計簿に収入として記録しました。実際の金額と違うときは「金額を直す」を押してください。');
  }
  if (errors.length) lines.push('', ...errors);
  return lines.join('\n');
}

/**
 * 毎月 day 日の支払いが date に当たるか（カレンダーを読む前に、給料日・仕送りの日の人だけに絞るため）。
 * 31日なら月末、短い月は月末に丸める
 */
export function paysOn(day: number, date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate()) === d;
}
