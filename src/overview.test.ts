import { describe, expect, it } from 'vitest';
import { assetSummary, sanitizeAccount } from './assets';
import { sanitizeFixedCost } from './fixed';
import { goalPlan, sanitizeGoal } from './goals';
import { financialOverview } from './overview';

const bank = sanitizeAccount({ id: 1, name: 'ゆうちょ', kind: 'savings' });
const nisa = sanitizeAccount({ id: 2, name: 'NISA', kind: 'nisa' });
const assets = assetSummary(
  [bank, nisa],
  [
    { accountId: 1, month: '2026-09', balance: 300000, contribution: 0 },
    { accountId: 1, month: '2026-11', balance: 360000, contribution: 0 },
    { accountId: 2, month: '2026-09', balance: 100000, contribution: 30000 },
    { accountId: 2, month: '2026-10', balance: 135000, contribution: 30000 },
  ],
  '2026-11',
  3,
);
const trip = sanitizeGoal({ id: 1, name: '旅行', target: 300000, saved: 60000, deadline: '2027-08' });
const goals = { monthlySurplus: 30000, basis: [], goals: [{ ...trip, ...goalPlan(trip, '2026-11', 30000) }] };

const input: Parameters<typeof financialOverview>[0] = {
  thisMonth: '2026-11',
  months: [
    { month: '2026-08', income: 0, expense: 0, saving: 0, byCategory: {} },
    {
      month: '2026-09',
      income: 150000,
      expense: 120000,
      saving: 4000,
      byCategory: { 住居: 60000, 食費: 40000, 趣味: 20000 },
    },
    {
      month: '2026-10',
      income: 0,
      expense: 120000,
      saving: 4000,
      byCategory: { 住居: 60000, 食費: 50000, 趣味: 10000 },
    },
  ],
  savings: new Set(['貯金・投資']),
  fixedCosts: [
    sanitizeFixedCost({ name: '家賃', amount: 60000, category: '住居' }),
    sanitizeFixedCost({ name: 'Amazonプライム', amount: 6000, category: '趣味', cycle: 'yearly', month: 3 }),
    sanitizeFixedCost({ name: 'ジム', amount: 7000, active: false }),
    sanitizeFixedCost({ name: 'NISA 積立', amount: 4000, category: '貯金・投資' }),
  ],
  budget: 100000,
  categoryBudgets: [{ categoryName: '食費', amount: 40000 }],
  goals,
  assets,
};

describe('financialOverview', () => {
  const o = financialOverview(input);

  it('記録のある月だけで、収入・支出・余りとカテゴリの平均を出す', () => {
    expect(o.period).toEqual({ months: ['2026-08', '2026-09', '2026-10'], usedMonths: 2 });
    expect(o.monthly).toEqual({
      income: 75000,
      expense: 120000,
      saving: 4000,
      surplus: -45000,
      leftAfterSaving: -49000,
    });
    expect(o.spendingByCategory).toEqual([
      { name: '住居', average: 60000, share: 0.5, budget: null },
      { name: '食費', average: 45000, share: 0.375, budget: 40000 },
      { name: '趣味', average: 15000, share: 0.125, budget: null },
    ]);
  });

  it('固定費は毎月にならし、やめたもの・貯金・投資は合計に入れない。予算と平均の差', () => {
    expect(o.fixedCosts).toEqual({
      monthlyTotal: 60500,
      shareOfExpense: 0.504,
      items: [
        { name: '家賃', category: '住居', monthly: 60000, autoRecord: true, saving: false },
        { name: 'Amazonプライム', category: '趣味', monthly: 500, autoRecord: true, saving: false },
        { name: 'NISA 積立', category: '貯金・投資', monthly: 4000, autoRecord: true, saving: true },
      ],
    });
    expect(o.budget).toEqual({ amount: 100000, minusAverageExpense: -20000 });
  });

  it('生活費の何か月分を預金で持っているか、目標、資産の変化', () => {
    expect(o.emergencyFund).toEqual({ liquid: 360000, monthsOfExpenses: 3 });
    expect(o.goals).toMatchObject({ monthlySurplus: 30000, totalPerMonth: 24000 });
    expect(o.assets.change).toEqual({ from: '2026-09', netWorth: 95000, contribution: 30000, marketGain: 5000 });
  });

  it('数字がずれていそうなところを知らせる', () => {
    expect(o.warnings).toEqual([
      '直近3か月のうち、記録がある月は2か月だけです。平均はその月だけで出しています。',
      '10月は収入の記録がありません。収入を記録していないと、毎月の余りが実際より少なく出ます。',
    ]);
  });

  it('残高が先月より古い口座を知らせる（先月の分は月末に入れるので知らせない）', () => {
    expect(financialOverview({ ...input, thisMonth: '2026-12' }).warnings).toContain('NISAの残高は10月のままです。');
  });

  it('記録も資産もなければ、出せないものは null', () => {
    const empty = financialOverview({
      ...input,
      months: input.months.map((m) => ({ ...m, income: 0, expense: 0, saving: 0, byCategory: {} })),
      fixedCosts: [],
      budget: 0,
      assets: assetSummary([], [], '2026-11', 3),
    });
    expect(empty).toMatchObject({
      monthly: { income: 0, expense: 0, saving: 0, surplus: 0, leftAfterSaving: 0 },
      budget: null,
      emergencyFund: null,
      fixedCosts: { monthlyTotal: 0, shareOfExpense: null },
      assets: { change: null },
    });
  });
});
