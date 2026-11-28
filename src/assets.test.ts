import { describe, expect, it } from 'vitest';
import { assetSummary, balanceForm, isInvestment, sameAccount, sanitizeAccount, type Balance } from './assets';

describe('sanitizeAccount', () => {
  it('型と範囲をそろえる。知らない種類は預金に', () => {
    expect(sanitizeAccount({ name: ' 楽天証券 NISA ', kind: 'nisa' })).toEqual({
      id: 0,
      name: '楽天証券 NISA',
      kind: 'nisa',
      active: true,
      memo: '',
    });
    expect(sanitizeAccount({ kind: 'gold', active: false })).toMatchObject({
      name: '口座',
      kind: 'savings',
      active: false,
    });
  });
  it('投資の口座だけ入れた額を持つ', () => {
    expect(isInvestment('nisa')).toBe(true);
    expect(isInvestment('savings')).toBe(false);
    expect(isInvestment('debt')).toBe(false);
  });
  it('id 以外が同じなら同じ', () => {
    const a = sanitizeAccount({ id: 1, name: '銀行' });
    expect(sameAccount(a, { ...a, id: 2 })).toBe(true);
    expect(sameAccount(a, { ...a, kind: 'other' })).toBe(false);
  });
});

describe('assetSummary', () => {
  const bank = sanitizeAccount({ id: 1, name: '銀行', kind: 'savings' });
  const nisa = sanitizeAccount({ id: 2, name: 'NISA', kind: 'nisa' });
  const loan = sanitizeAccount({ id: 3, name: '奨学金', kind: 'debt' });
  const b = (accountId: number, month: string, balance: number, contribution = 0): Balance => ({
    accountId,
    month,
    balance,
    contribution,
  });
  const balances = [
    b(1, '2026-09', 300000),
    b(1, '2026-10', 320000),
    // 銀行は 11 月を入れていない → 10 月の残高を使う
    b(2, '2026-09', 100000, 30000),
    b(2, '2026-10', 135000, 30000),
    b(2, '2026-11', 160000, 30000),
    b(3, '2026-09', 500000),
    b(3, '2026-11', 480000),
  ];

  it('今の残高・純資産・資産の分け方', () => {
    const s = assetSummary([bank, nisa, loan], balances, '2026-11', 3);
    expect(s.accounts.map((a) => [a.name, a.balance, a.month])).toEqual([
      ['銀行', 320000, '2026-10'],
      ['NISA', 160000, '2026-11'],
      ['奨学金', 480000, '2026-11'],
    ]);
    expect(s.totals).toEqual({ assets: 480000, debts: 480000, netWorth: 0 });
    expect(s.allocation).toEqual([
      { kind: 'savings', label: '預金・現金', amount: 320000, share: 0.667 },
      { kind: 'nisa', label: 'NISA', amount: 160000, share: 0.333 },
    ]);
  });

  it('月ごとの純資産と、入れた額・値動き', () => {
    expect(assetSummary([bank, nisa, loan], balances, '2026-11', 3).history).toEqual([
      // 9 月は前の月がないので、入れた額も値動きも数えない
      { month: '2026-09', netWorth: -100000, contribution: 0, marketGain: 0 },
      // NISA：10万 → 13.5万、入れた額 3万 → 値動き +5千
      { month: '2026-10', netWorth: -45000, contribution: 30000, marketGain: 5000 },
      // NISA：13.5万 → 16万、入れた額 3万 → 値動き −5千
      { month: '2026-11', netWorth: 0, contribution: 30000, marketGain: -5000 },
    ]);
  });

  it('残高を入れる前の月は出さない', () => {
    expect(assetSummary([bank], balances, '2026-11', 6).history.map((h) => h.month)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });
});

describe('balanceForm', () => {
  const bank = sanitizeAccount({ id: 1, name: '銀行', kind: 'savings' });
  const nisa = sanitizeAccount({ id: 2, name: 'NISA', kind: 'nisa' });
  const closed = sanitizeAccount({ id: 3, name: '昔の口座', active: false });
  const balances: Balance[] = [
    { accountId: 1, month: '2026-09', balance: 300000, contribution: 0 },
    { accountId: 2, month: '2026-10', balance: 135000, contribution: 30000 },
    { accountId: 2, month: '2026-11', balance: 160000, contribution: 25000 },
  ];
  it('まだ入れていない月は、前の残高を目安に、入れた額は前の月と同じ', () => {
    expect(balanceForm([bank, nisa, closed], balances, '2026-12')).toEqual([
      { accountId: 1, balance: null, contribution: null, lastBalance: 300000, lastMonth: '2026-09' },
      { accountId: 2, balance: null, contribution: 25000, lastBalance: 160000, lastMonth: '2026-11' },
    ]);
  });
  it('もう入れた月は、その値', () => {
    expect(balanceForm([nisa], balances, '2026-11')).toEqual([
      { accountId: 2, balance: 160000, contribution: 25000, lastBalance: 135000, lastMonth: '2026-10' },
    ]);
  });
});
