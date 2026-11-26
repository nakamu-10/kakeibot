import { describe, expect, it } from 'vitest';
import {
  buildReport,
  calcShift,
  jstMidnight,
  nightMinutes,
  parseBreakOverride,
  payInfo,
  sanitizeAllowance,
  sanitizeJob,
  type RawShift,
  type ShiftSettings,
} from './calc';

// GAS版で確認済みの設定と期待値
const cafe = sanitizeJob({
  id: 1,
  name: '珈琲館',
  weekdayRate: 1200,
  weekendRate: 1300,
  holidayAsWeekend: true,
  nightEnabled: true,
  nightPremium: 25,
  breaks: [
    { overHours: 6, minutes: 45 },
    { overHours: 8, minutes: 60 },
  ],
  transport: 300,
  closingDay: 31,
  payMonthOffset: 1,
  payDay: 25,
});
const juku = sanitizeJob({
  id: 2,
  name: '塾',
  weekdayRate: 1500,
  roundUnit: 15,
  closingDay: 15,
  payMonthOffset: 0,
  payDay: 31,
});
const settings: ShiftSettings = {
  jobs: [cafe, juku],
  allowances: [sanitizeAllowance({ id: 1, name: '仕送り', amount: 50000, day: 1 })],
  wall: 0,
};
const holidays = new Set(['2026-11-23']);

/** 日本時間の 'YYYY-MM-DD' と時・分から UNIX ミリ秒 */
function at(date: string, h: number, mi = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  return jstMidnight(y, m, d) + (h * 60 + mi) * 60_000;
}

function shift(jobId: number, date: string, from: [number, number], to: [number, number], desc = ''): RawShift {
  const start = at(date, from[0], from[1]);
  let end = at(date, to[0], to[1]);
  if (end <= start) end += 86_400_000; // 日をまたぐ
  return { jobId, start, end, breakOverride: parseBreakOverride(desc) };
}

const shifts = {
  cafeWeekday: shift(1, '2026-11-25', [9, 0], [16, 0]),
  cafeSaturdayNight: shift(1, '2026-11-28', [18, 0], [23, 0]),
  cafeHoliday: shift(1, '2026-11-23', [10, 0], [14, 0]),
  jukuRounded: shift(2, '2026-11-10', [17, 0], [19, 50]),
  jukuBreakOverride: shift(2, '2026-11-20', [17, 0], [20, 0], '休憩30'),
  cafeOvernight: shift(1, '2026-10-31', [22, 0], [2, 0]),
};

describe('calcShift', () => {
  it('平日・6時間超なので45分休憩', () => {
    expect(calcShift(cafe, shifts.cafeWeekday, holidays)).toMatchObject({ workMin: 375, rate: 1200, pay: 7500 });
  });
  it('土曜の夜は土日の時給と深夜手当', () => {
    expect(calcShift(cafe, shifts.cafeSaturdayNight, holidays)).toMatchObject({
      nightMin: 60,
      rate: 1300,
      pay: 6825,
    });
  });
  it('祝日は土日の時給', () => {
    expect(calcShift(cafe, shifts.cafeHoliday, holidays)).toMatchObject({ isHoliday: true, rate: 1300, pay: 5200 });
  });
  it('15分単位で切り捨てる', () => {
    expect(calcShift(juku, shifts.jukuRounded, holidays)).toMatchObject({ workMin: 165, pay: 4125 });
  });
  it('説明欄の「休憩30」で休憩を上書き', () => {
    expect(calcShift(juku, shifts.jukuBreakOverride, holidays)).toMatchObject({
      breakMin: 30,
      workMin: 150,
      pay: 3750,
    });
  });
  it('日をまたぐ深夜のシフトは全部深夜（開始日の土曜で判定）', () => {
    expect(calcShift(cafe, shifts.cafeOvernight, holidays)).toMatchObject({
      workMin: 240,
      nightMin: 240,
      rate: 1300,
      pay: 6500,
    });
  });
});

describe('payInfo', () => {
  it('15日締め・当月末払い', () => {
    expect(payInfo(juku, { y: 2026, m: 11, d: 10 })).toMatchObject({
      periodStart: '2026-10-16',
      periodEnd: '2026-11-15',
      payDate: '2026-11-30',
    });
    expect(payInfo(juku, { y: 2026, m: 11, d: 20 }).payDate).toBe('2026-12-31');
  });
  it('末締め・翌月25日払い', () => {
    expect(payInfo(cafe, { y: 2026, m: 10, d: 31 })).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payDate: '2026-11-25',
    });
    expect(payInfo(cafe, { y: 2027, m: 1, d: 31 })).toMatchObject({
      periodStart: '2027-01-01',
      periodEnd: '2027-01-31',
      payDate: '2027-02-25',
    });
  });
  it('30日締め・翌月末払いで1/31は2月の締めに入る', () => {
    const job = sanitizeJob({ closingDay: 30, payMonthOffset: 1, payDay: 31 });
    expect(payInfo(job, { y: 2027, m: 1, d: 31 })).toMatchObject({
      periodStart: '2027-01-31',
      periodEnd: '2027-02-28',
      payDate: '2027-03-31',
    });
  });
});

describe('buildReport', () => {
  const report = buildReport(settings, Object.values(shifts), holidays, 2026, 11, at('2026-11-27', 7));

  it('11月の入金予定', () => {
    expect(report.incoming.map((p) => [p.payDate, p.name, p.total])).toEqual([
      ['2026-11-01', '仕送り', 50000],
      ['2026-11-25', '珈琲館', 6800],
      ['2026-11-30', '塾', 4125],
    ]);
    expect(report.incoming[1]).toMatchObject({ gross: 6500, transport: 300 });
  });
  it('11月に働いた分', () => {
    expect(report.work).toEqual([
      { name: '珈琲館', count: 3, workMin: 915, pay: 19525, transport: 900 },
      { name: '塾', count: 2, workMin: 315, pay: 7875, transport: 0 },
    ]);
    expect(report.shifts).toHaveLength(5);
  });
  it('2026年に支給される給与', () => {
    expect(report.yearDone).toBe(27075);
    expect(report.yearPlanned).toBe(6825);
    expect(report.byMonth[10]).toBe(10625);
    expect(report.byMonth[11]).toBe(23275);
  });
  it('交通費は同じバイト先・同じ日なら1回だけ', () => {
    const twice = [shift(1, '2026-11-25', [9, 0], [12, 0]), shift(1, '2026-11-25', [17, 0], [20, 0])];
    const r = buildReport(settings, twice, holidays, 2026, 11, 0);
    expect(r.work[0].transport).toBe(300);
  });
});

describe('細かい部品', () => {
  it('休憩の書き方', () => {
    expect(parseBreakOverride('休憩60')).toBe(60);
    expect(parseBreakOverride('メモ 休憩：30分')).toBe(30);
    expect(parseBreakOverride('')).toBeNull();
  });
  it('深夜の分数（22時〜翌5時）', () => {
    expect(nightMinutes(at('2026-11-01', 21), at('2026-11-02', 6))).toBe(420);
    expect(nightMinutes(at('2026-11-01', 3), at('2026-11-01', 6))).toBe(120);
  });
  it('設定の範囲をそろえる', () => {
    expect(sanitizeJob({ closingDay: 40, payMonthOffset: -1, roundUnit: 0, breaks: [{ minutes: 0 }] })).toMatchObject({
      name: 'バイト先',
      closingDay: 31,
      payMonthOffset: 0,
      roundUnit: 1,
      breaks: [],
      nightPremium: 25,
    });
  });
});
