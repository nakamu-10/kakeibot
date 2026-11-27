import { describe, expect, it } from 'vitest';
import type { SalaryIncoming } from './calc';
import type { ShiftReport } from './report';
import { incomingOn, incomingText, paydayText, paysOn, salaryMemo } from './text';

const base = {
  year: 2026,
  month: 11,
  incomingTotal: 60925,
  work: [],
  workPayTotal: 0,
  workMinTotal: 0,
  shifts: [],
  yearDone: 0,
  yearPlanned: 0,
  byMonth: [],
  wall: 0,
  errors: [],
  unmatchedTitles: [],
  hasJobs: true,
  hasCalendar: true,
} satisfies Omit<ShiftReport, 'incoming'>;

const cafe: SalaryIncoming = {
  type: 'salary',
  jobId: 1,
  name: '珈琲館',
  payDate: '2026-11-25',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  count: 1,
  workMin: 240,
  gross: 6500,
  transport: 300,
  total: 6800,
};
const juku: SalaryIncoming = {
  type: 'salary',
  jobId: 2,
  name: '塾',
  payDate: '2026-11-30',
  periodStart: '2026-10-16',
  periodEnd: '2026-11-15',
  count: 1,
  workMin: 165,
  gross: 4125,
  transport: 0,
  total: 4125,
};
const report: ShiftReport = {
  ...base,
  incoming: [{ type: 'allowance', allowanceId: 1, name: '仕送り', payDate: '2026-11-01', total: 50000 }, cafe, juku],
};

describe('incomingText', () => {
  it('その月の入金予定と合計', () => {
    expect(incomingText(report)).toBe(
      [
        '2026年11月の入金予定',
        '',
        '11/1 仕送り ¥50,000',
        '11/25 珈琲館 ¥6,800',
        '  10/1〜10/31分・1回・4時間・うち交通費 ¥300',
        '11/30 塾 ¥4,125',
        '  10/16〜11/15分・1回・2時間45分',
        '',
        '合計 ¥60,925',
      ].join('\n'),
    );
  });
  it('未設定なら登録を案内する', () => {
    expect(incomingText({ ...base, incoming: [], hasJobs: false })).toContain('まだ設定されていません');
  });
  it('読めなかったカレンダーを書き添える', () => {
    expect(incomingText({ ...report, errors: ['カレンダーが見つかりません'] })).toMatch(/見つかりません$/);
  });
});

describe('incomingOn', () => {
  it('その日の給与と仕送りに分ける', () => {
    expect(incomingOn(report, '2026-11-25')).toEqual({ salaries: [cafe], allowances: [] });
    expect(incomingOn(report, '2026-11-01').allowances.map((a) => a.allowanceId)).toEqual([1]);
  });
});

describe('paydayText', () => {
  it('給料日と見込み額。記録したらそのことも伝える', () => {
    expect(paydayText([cafe], false, [])).toBe('今日は珈琲館の給料日です。見込み ¥6,800（10/1〜10/31分）');
    expect(paydayText([cafe], true, [])).toContain('家計簿に収入として記録しました');
  });
  it('家計簿のメモ', () => {
    expect(salaryMemo(cafe)).toBe('珈琲館 10/1〜10/31分');
  });
});

describe('paysOn', () => {
  it('毎月の支払日に当たるか。31日払いは月末、短い月は月末に丸める', () => {
    expect(paysOn(25, '2026-11-25')).toBe(true);
    expect(paysOn(31, '2026-11-30')).toBe(true);
    expect(paysOn(31, '2027-02-28')).toBe(true);
    expect(paysOn(30, '2027-02-28')).toBe(true);
    expect(paysOn(25, '2026-11-24')).toBe(false);
  });
});
