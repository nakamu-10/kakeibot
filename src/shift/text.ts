import { yen } from '../util';
import type { Job } from './calc';
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

/** 給料日の朝の通知。その日に支給される給与がなければ null */
export function paydayText(r: ShiftReport, today: string): string | null {
  const pays = r.incoming.flatMap((p) => (p.type === 'salary' && p.payDate === today ? [p] : []));
  if (!pays.length) return null;
  const lines = pays.map(
    (p) => `今日は${p.name}の給料日です。見込み ${yen(p.total)}（${md(p.periodStart)}〜${md(p.periodEnd)}分）`,
  );
  if (r.errors.length) lines.push('', ...r.errors);
  return lines.join('\n');
}

/**
 * その日が給料日のバイト先（カレンダーを読む前に、通知が要る人だけに絞るため）。
 * 給料日が31日なら月末、短い月は月末に丸める
 */
export function jobsPayingOn(jobs: Job[], date: string): Job[] {
  const [y, m, d] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return jobs.filter((j) => Math.min(j.payDay, lastDay) === d);
}
