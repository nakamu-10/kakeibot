import { describe, expect, it } from 'vitest';
import { budgetStatus, categoryTree, compareGroups, usageInsights, type InsightRow } from './stats';

describe('budgetStatus', () => {
  it('今月の途中：日割りのペースと、残りの日に使える額', () => {
    expect(budgetStatus('2026-11', '2026-11-10', 20000, 60000)).toEqual({
      month: '2026-11',
      budget: 60000,
      spent: 20000,
      remaining: 40000,
      daysInMonth: 30,
      daysPassed: 10,
      dailyAverage: 2000,
      projectedTotal: 60000,
      safeDailySpend: 1904, // 40000 / 21日（今日を含む）
    });
  });
  it('過ぎた月は、もう終わった月として見る。予算がなければ null', () => {
    expect(budgetStatus('2026-10', '2026-11-10', 31000, 0)).toMatchObject({
      daysPassed: 31,
      dailyAverage: 1000,
      projectedTotal: 31000,
      budget: null,
      remaining: null,
      safeDailySpend: null,
    });
  });
});

describe('compareGroups', () => {
  it('両方の月のカテゴリを並べ、差の大きい順', () => {
    const a = [
      { name: '食費', total: 30000, children: [] },
      { name: '交際費', total: 5000, children: [] },
    ];
    const b = [
      { name: '食費', total: 32000, children: [] },
      { name: '趣味', total: 9000, children: [] },
    ];
    expect(compareGroups(a, b)).toEqual([
      { category: '趣味', monthA: 0, monthB: 9000, diff: 9000 },
      { category: '交際費', monthA: 5000, monthB: 0, diff: -5000 },
      { category: '食費', monthA: 30000, monthB: 32000, diff: 2000 },
    ]);
  });
});

describe('categoryTree', () => {
  it('親の下に子をまとめる', () => {
    const cats = [
      { id: 1, name: '日用品', type: 'expense' as const, keywords: '', parentId: 0 },
      { id: 2, name: '雑貨', type: 'expense' as const, keywords: 'ハンガー', parentId: 1 },
      { id: 3, name: '給与', type: 'income' as const, keywords: '', parentId: 0 },
    ];
    expect(categoryTree(cats)).toEqual([
      { name: '日用品', type: 'expense', keywords: '', children: [{ name: '雑貨', keywords: 'ハンガー' }] },
      { name: '給与', type: 'income', keywords: '', children: [] },
    ]);
  });
});

describe('usageInsights', () => {
  const row = (date: string, category: string, extra: Partial<InsightRow> = {}): InsightRow => ({
    date,
    category,
    memo: '',
    source: 'text',
    edit_count: 0,
    created_at: `${date} 03:00:00`, // 日本時間で同じ日の昼
    ...extra,
  });
  const rows = [
    row('2026-11-02', '食費'),
    row('2026-11-02', 'その他', { memo: '牛丼' }),
    row('2026-11-03', 'その他', { memo: '牛丼', source: 'receipt' }),
    row('2026-11-03', '日用品', { edit_count: 2 }),
    // 11/4 の分を 11/5（日本時間）に付けた
    row('2026-11-04', 'その他', { memo: 'ガム', created_at: '2026-11-04 16:00:00', edit_count: 1 }),
  ];
  const r = usageInsights(rows, '2026-11-01', '2026-11-07');

  it('記録の付け方と、「その他」のよくあるメモ', () => {
    expect(r.entries).toBe(5);
    expect(r.bySource).toEqual([
      { source: 'text', count: 4, share: 80 },
      { source: 'receipt', count: 1, share: 20 },
    ]);
    expect(r.other).toEqual({
      count: 3,
      share: 60,
      topMemos: [
        { name: '牛丼', count: 2 },
        { name: 'ガム', count: 1 },
      ],
    });
  });
  it('直された記録のカテゴリ', () => {
    expect(r.edited).toEqual({
      count: 2,
      share: 40,
      topCategories: [
        { name: '日用品', count: 1 },
        { name: 'その他', count: 1 },
      ],
    });
  });
  it('記録のない日と曜日、あとから付けた記録', () => {
    // 11/1（日）〜11/7（土）のうち、記録があるのは 2・3・4 日
    expect(r.daysWithoutEntries.count).toBe(4);
    expect(r.daysWithoutEntries.byWeekday.filter((d) => d.count).map((d) => d.weekday)).toEqual([
      '日',
      '木',
      '金',
      '土',
    ]);
    expect(r.recordedLater).toEqual({ count: 1, share: 20 });
  });
});
