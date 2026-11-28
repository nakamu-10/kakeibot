import { describe, expect, it } from 'vitest';
import { averageSurplus, goalPlan, sameGoal, sanitizeGoal, savedOf } from './goals';

describe('sanitizeGoal', () => {
  it('型と範囲をそろえる。期限は YYYY-MM だけ', () => {
    expect(sanitizeGoal({ name: ' 旅行 ', target: '300000', saved: -5, deadline: '2027-08-31' })).toEqual({
      id: 0,
      name: '旅行',
      target: 300000,
      saved: 0,
      accountIds: [],
      deadline: '2027-08',
      memo: '',
    });
    expect(sanitizeGoal({ deadline: '2027-13' }).deadline).toBe('');
  });
  it('つないだ口座は、配列でも DB の JSON でも。重なり・0以下は除く', () => {
    expect(sanitizeGoal({ accountIds: [2, 2, -1, 3] }).accountIds).toEqual([2, 3]);
    expect(sanitizeGoal({ account_ids: '[4,5]' }).accountIds).toEqual([4, 5]);
    expect(sanitizeGoal({ account_ids: 'こわれた' }).accountIds).toEqual([]);
  });
});

describe('sameGoal', () => {
  it('id 以外が同じなら同じ', () => {
    const a = sanitizeGoal({ id: 1, name: '旅行', target: 300000 });
    expect(sameGoal(a, { ...a, id: 2 })).toBe(true);
    expect(sameGoal(a, { ...a, saved: 1000 })).toBe(false);
  });
});

describe('savedOf', () => {
  const accounts = [
    { id: 1, kind: 'savings', balance: 120000 },
    { id: 2, kind: 'savings', balance: 80000 },
    { id: 3, kind: 'debt', balance: 500000 },
  ];
  it('口座をつないでいれば残高の合計（借金は数えない）、なければ入れた額', () => {
    expect(savedOf(sanitizeGoal({ saved: 1, accountIds: [1, 2, 3] }), accounts)).toBe(200000);
    expect(savedOf(sanitizeGoal({ saved: 5000 }), accounts)).toBe(5000);
  });
});

describe('averageSurplus', () => {
  it('記録のない月は数えない', () => {
    expect(
      averageSurplus([
        { income: 0, expense: 0 },
        { income: 150000, expense: 120000 },
        { income: 150000, expense: 100000 },
      ]),
    ).toBe(40000);
    expect(averageSurplus([{ income: 0, expense: 0 }])).toBeNull();
  });
});

describe('goalPlan', () => {
  const trip = sanitizeGoal({ name: '旅行', target: 300000, saved: 60000, deadline: '2027-08' });

  it('期限までの毎月の額と、今のペースで届く月', () => {
    // 2026-11 から 2027-08 まで 10 か月。残り 24万 → 毎月 2.4万
    expect(goalPlan(trip, '2026-11', 30000)).toEqual({
      remaining: 240000,
      progress: 0.2,
      monthsLeft: 10,
      perMonth: 24000,
      reachMonth: '2027-06',
      onTrack: true,
    });
    expect(goalPlan(trip, '2026-11', 20000).onTrack).toBe(false);
  });
  it('収支がマイナスなら、届く月は出さない', () => {
    expect(goalPlan(trip, '2026-11', -10000)).toMatchObject({ reachMonth: null, onTrack: false });
    expect(goalPlan(trip, '2026-11', null)).toMatchObject({ reachMonth: null, onTrack: null });
  });
  it('期限を過ぎたら、残りを今月で。期限なしなら毎月の額は出さない', () => {
    expect(goalPlan(trip, '2027-10', 30000)).toMatchObject({ monthsLeft: 1, perMonth: 240000 });
    expect(goalPlan({ ...trip, deadline: '' }, '2026-11', 30000)).toMatchObject({ perMonth: null, onTrack: null });
  });
  it('届いたら残り0、今月で達成', () => {
    expect(goalPlan({ ...trip, saved: 300000 }, '2026-11', 0)).toMatchObject({
      remaining: 0,
      progress: 1,
      reachMonth: '2026-11',
    });
  });
});
