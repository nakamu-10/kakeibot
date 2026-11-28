import { describe, expect, it } from 'vitest';
import {
  accountChange,
  balanceChange,
  budgetChange,
  categoryBudgetChange,
  entryChange,
  fixedCostChange,
  goalChange,
  sameEntry,
} from './changes';
import { sanitizeAccount } from './assets';
import { sanitizeGoal } from './goals';
import { sanitizeFixedCost } from './fixed';
import type { Entry } from './types';

const lunch: Entry = {
  id: 7,
  type: 'expense',
  category: '食費',
  amount: 800,
  memo: 'ランチ',
  store: '',
  date: '2026-11-27',
  source: 'ai',
};

describe('entryChange', () => {
  it('追加・変更・削除の要約', () => {
    expect(entryChange('insert', null, lunch)).toMatchObject({
      target: 'entry',
      targetId: 7,
      op: 'insert',
      summary: '追加：食費 ¥800（11/27 ランチ）',
    });
    expect(entryChange('update', lunch, { ...lunch, amount: 900 }).summary).toBe(
      '変更：食費 ¥800（11/27 ランチ） → 食費 ¥900（11/27 ランチ）',
    );
    expect(entryChange('delete', lunch, null)).toMatchObject({ targetId: 7, before: lunch, after: null });
  });
});

describe('budgetChange', () => {
  it('予算の要約。0 は「なし」', () => {
    expect(budgetChange(0, 50000).summary).toBe('予算：なし → ¥50,000');
    expect(budgetChange(50000, 45000)).toMatchObject({ before: { amount: 50000 }, after: { amount: 45000 } });
  });
});

describe('categoryBudgetChange', () => {
  it('カテゴリ別予算の要約。追加・変更・削除', () => {
    expect(categoryBudgetChange('食費', 0, 30000)).toMatchObject({
      target: 'category_budget',
      op: 'insert',
      summary: '食費の予算：なし → ¥30,000',
    });
    expect(categoryBudgetChange('食費', 30000, 25000)).toMatchObject({
      op: 'update',
      summary: '食費の予算：¥30,000 → ¥25,000',
    });
    expect(categoryBudgetChange('食費', 25000, 0)).toMatchObject({
      op: 'delete',
      summary: '食費の予算：¥25,000 → なし',
    });
  });
});

describe('fixedCostChange', () => {
  it('固定費の要約。毎年とやめたものも分かる', () => {
    const prime = sanitizeFixedCost({ id: 3, name: 'Amazonプライム', amount: 5900, cycle: 'yearly', month: 3 });
    expect(fixedCostChange('insert', null, prime)).toMatchObject({
      target: 'fixed_cost',
      targetId: 3,
      summary: '固定費を追加：Amazonプライム ¥5,900/年',
    });
    expect(fixedCostChange('update', prime, { ...prime, active: false }).summary).toBe(
      '固定費を変更：Amazonプライム ¥5,900/年 → Amazonプライム ¥5,900/年（やめた）',
    );
  });
});

describe('goalChange', () => {
  it('目標の要約。期限があれば月まで', () => {
    const trip = sanitizeGoal({ id: 5, name: '旅行', target: 300000, saved: 60000, deadline: '2027-08' });
    expect(goalChange('insert', null, trip)).toMatchObject({
      target: 'goal',
      targetId: 5,
      summary: '目標を追加：旅行 ¥60,000/¥300,000（2027年8月まで）',
    });
    expect(goalChange('delete', { ...trip, deadline: '' }, null).summary).toBe('目標を削除：旅行 ¥60,000/¥300,000');
    expect(goalChange('update', trip, { ...trip, accountIds: [1, 2] }).summary).toBe(
      '目標を変更：旅行 ¥60,000/¥300,000（2027年8月まで） → 旅行 口座2つから/¥300,000（2027年8月まで）',
    );
  });
});

describe('accountChange / balanceChange', () => {
  it('口座と残高の要約。入れた額は投資の口座だけ', () => {
    const nisa = sanitizeAccount({ id: 2, name: 'NISA', kind: 'nisa' });
    expect(accountChange('update', nisa, { ...nisa, active: false }).summary).toBe(
      '口座を変更：NISA（NISA） → NISA（NISA）・解約',
    );
    const after = { accountId: 2, month: '2026-11', balance: 160000, contribution: 30000 };
    expect(balanceChange('NISA', null, after)).toMatchObject({
      target: 'balance',
      op: 'insert',
      summary: 'NISAの11月の残高：¥160,000（入れた額 ¥30,000）',
    });
    expect(
      balanceChange('銀行', { ...after, balance: 1, contribution: 0 }, { ...after, contribution: 0 }).summary,
    ).toBe('銀行の11月の残高：¥1 → ¥160,000');
  });
});

describe('sameEntry', () => {
  it('取り消してよいのは、変えたあとから誰も直していないときだけ', () => {
    const sameButOtherIdAndStore: Entry = { ...lunch, id: 99, store: 'どこか' };
    expect(sameEntry(lunch, sameButOtherIdAndStore)).toBe(true);
    expect(sameEntry({ ...lunch, amount: 1000 }, lunch)).toBe(false);
    expect(sameEntry({ ...lunch, category: '交際費' }, lunch)).toBe(false);
  });
});
