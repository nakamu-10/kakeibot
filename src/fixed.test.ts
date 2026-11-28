import { describe, expect, it } from 'vitest';
import { findRecurring, monthlyAmount, monthlyTotal, recordsOn, sameFixedCost, sanitizeFixedCost } from './fixed';

describe('sanitizeFixedCost', () => {
  it('型と範囲をそろえる。毎月なら月は 0', () => {
    expect(sanitizeFixedCost({ name: ' Netflix ', amount: '1490.4', category: '趣味', day: 40 })).toEqual({
      id: 0,
      name: 'Netflix',
      amount: 1490,
      category: '趣味',
      cycle: 'monthly',
      day: 31,
      month: 0,
      active: true,
      autoRecord: true,
      memo: '',
    });
    expect(sanitizeFixedCost({ cycle: 'yearly', month: 13, active: false })).toMatchObject({
      name: '固定費',
      cycle: 'yearly',
      month: 12,
      active: false,
    });
  });
});

describe('monthlyAmount / monthlyTotal', () => {
  it('毎年は12で割り、やめたものは数えない', () => {
    expect(monthlyAmount({ amount: 12000, cycle: 'yearly' })).toBe(1000);
    expect(
      monthlyTotal([
        { amount: 60000, cycle: 'monthly', active: true },
        { amount: 5980, cycle: 'yearly', active: true },
        { amount: 1490, cycle: 'monthly', active: false },
      ]),
    ).toBe(60498);
  });
});

describe('sameFixedCost', () => {
  it('id 以外が同じなら同じ', () => {
    const a = sanitizeFixedCost({ id: 1, name: '家賃', amount: 60000 });
    expect(sameFixedCost(a, { ...a, id: 2 })).toBe(true);
    expect(sameFixedCost(a, { ...a, amount: 61000 })).toBe(false);
  });
});

describe('recordsOn', () => {
  const rent = sanitizeFixedCost({ name: '家賃', amount: 60000, day: 27 });
  it('毎月は払う日に。月末より後の日は月末に', () => {
    expect(recordsOn(rent, '2026-11-27')).toBe(true);
    expect(recordsOn(rent, '2026-11-26')).toBe(false);
    const end = { ...rent, day: 31 };
    expect(recordsOn(end, '2026-11-30')).toBe(true);
    expect(recordsOn(end, '2027-02-28')).toBe(true);
    expect(recordsOn(end, '2026-12-30')).toBe(false);
  });
  it('毎年は払う月だけ', () => {
    const prime = { ...rent, cycle: 'yearly' as const, month: 3, day: 15 };
    expect(recordsOn(prime, '2027-03-15')).toBe(true);
    expect(recordsOn(prime, '2026-11-15')).toBe(false);
  });
  it('やめたもの・自動で記録しないものは記録しない', () => {
    expect(recordsOn({ ...rent, active: false }, '2026-11-27')).toBe(false);
    expect(recordsOn({ ...rent, autoRecord: false }, '2026-11-27')).toBe(false);
  });
});

describe('findRecurring', () => {
  const e = (date: string, memo: string, amount: number, category = '趣味', store = '') => ({
    date,
    category,
    amount,
    memo,
    store,
  });
  const entries = [
    e('2026-09-05', 'Netflix', 1490),
    e('2026-10-05', 'Netflix', 1490),
    e('2026-11-05', 'Netflix', 1490),
    e('2026-10-10', 'ジム', 7000, '美容'),
    e('2026-11-10', 'ジム', 7200, '美容'),
    // 毎月だが金額がばらばら → 固定費ではない
    e('2026-10-01', 'スーパー', 2000, '食費'),
    e('2026-11-01', 'スーパー', 5000, '食費'),
    // 1か月に何度も → 固定費ではない
    e('2026-10-02', 'ランチ', 800, '食費'),
    e('2026-10-03', 'ランチ', 800, '食費'),
    e('2026-10-04', 'ランチ', 800, '食費'),
    e('2026-11-02', 'ランチ', 800, '食費'),
    // 1か月だけ → 固定費ではない
    e('2026-11-20', '映画', 1900),
  ];

  it('2か月以上・ほぼ同じ金額・月に1回ほどのものを、多い月の順に', () => {
    expect(findRecurring(entries, [])).toEqual([
      { name: 'Netflix', category: '趣味', amount: 1490, months: 3, lastDate: '2026-11-05' },
      { name: 'ジム', category: '美容', amount: 7200, months: 2, lastDate: '2026-11-10' },
    ]);
  });
  it('登録済みの固定費は除く', () => {
    expect(findRecurring(entries, [{ name: 'netflix' }]).map((r) => r.name)).toEqual(['ジム']);
  });
});
