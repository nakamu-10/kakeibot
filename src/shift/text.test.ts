import { describe, expect, it } from 'vitest';
import { sanitizeJob } from './calc';
import type { ShiftReport } from './report';
import { incomingText, jobsPayingOn, paydayText } from './text';

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
  hasJobs: true,
} satisfies Omit<ShiftReport, 'incoming'>;

const report: ShiftReport = {
  ...base,
  incoming: [
    { type: 'allowance', name: '仕送り', payDate: '2026-11-01', total: 50000 },
    {
      type: 'salary',
      name: '珈琲館',
      payDate: '2026-11-25',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      count: 1,
      workMin: 240,
      gross: 6500,
      transport: 300,
      total: 6800,
    },
    {
      type: 'salary',
      name: '塾',
      payDate: '2026-11-30',
      periodStart: '2026-10-16',
      periodEnd: '2026-11-15',
      count: 1,
      workMin: 165,
      gross: 4125,
      transport: 0,
      total: 4125,
    },
  ],
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
    expect(incomingText({ ...report, errors: ['塾：カレンダーのURLが未登録です'] })).toMatch(/未登録です$/);
  });
});

describe('paydayText', () => {
  it('その日の給与だけを知らせる（仕送りは含めない）', () => {
    expect(paydayText(report, '2026-11-25')).toBe('今日は珈琲館の給料日です。見込み ¥6,800（10/1〜10/31分）');
    expect(paydayText(report, '2026-11-01')).toBeNull();
  });
});

describe('jobsPayingOn', () => {
  const jobs = [sanitizeJob({ id: 1, payDay: 25 }), sanitizeJob({ id: 2, payDay: 31 })];
  it('給料日の日付で選ぶ。31日払いは月末に丸める', () => {
    expect(jobsPayingOn(jobs, '2026-11-25').map((j) => j.id)).toEqual([1]);
    expect(jobsPayingOn(jobs, '2026-11-30').map((j) => j.id)).toEqual([2]);
    expect(jobsPayingOn(jobs, '2027-02-28').map((j) => j.id)).toEqual([2]);
    expect(jobsPayingOn(jobs, '2026-11-29')).toEqual([]);
  });
});
