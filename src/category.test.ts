import { describe, expect, it } from 'vitest';
import { categoryTreeText, groupByParent, orderCategories, parentError, parentName } from './category';
import { parseEntry } from './parse';
import type { Category } from './types';

const cat = (id: number, name: string, parentId = 0, sort = id, type: Category['type'] = 'expense'): Category => ({
  id,
  name,
  type,
  sort,
  keywords: '',
  parentId,
});
// 食費・日用品（服・雑貨）・交通費、給与（収入）
const cats = [
  cat(1, '食費'),
  cat(2, '日用品'),
  cat(3, '交通費'),
  cat(4, '雑貨', 2, 9),
  cat(5, '服', 2, 8),
  cat(6, '給与', 0, 1, 'income'),
];

describe('orderCategories', () => {
  it('親の並び順で、子をすぐ下に並べる', () => {
    expect(orderCategories(cats).map((c) => c.name)).toEqual(['食費', '給与', '日用品', '服', '雑貨', '交通費']);
  });
  it('親が消えた子は一番上の段として扱う', () => {
    expect(orderCategories([cat(1, '食費'), cat(9, '迷子', 99, 0)]).map((c) => c.name)).toEqual(['迷子', '食費']);
  });
});

describe('parentError', () => {
  it('2段までで、同じ種類の一番上のカテゴリだけ親にできる', () => {
    expect(parentError(cats, { id: 0, type: 'expense' }, 2)).toBeNull();
    expect(parentError(cats, { id: 0, type: 'expense' }, 0)).toBeNull();
    expect(parentError(cats, { id: 0, type: 'expense' }, 5)).toContain('子カテゴリなので');
    expect(parentError(cats, { id: 0, type: 'expense' }, 6)).toContain('支出と収入');
    expect(parentError(cats, { id: 1, type: 'expense' }, 1)).toContain('自分自身');
    expect(parentError(cats, { id: 1, type: 'expense' }, 99)).toContain('見つかりません');
  });
  it('子を持つカテゴリは、ほかの下に入れられない', () => {
    expect(parentError(cats, { id: 2, type: 'expense' }, 1)).toContain('子カテゴリを持つ');
  });
});

describe('groupByParent', () => {
  it('親でまとめ、子の内訳と親そのものの記録を添える（多い順）', () => {
    expect(groupByParent({ 食費: 5000, 服: 8000, 雑貨: 3000, 日用品: 1000 }, cats)).toEqual([
      {
        name: '日用品',
        total: 12000,
        children: [
          { name: '服', amount: 8000 },
          { name: '雑貨', amount: 3000 },
          { name: '（日用品）', amount: 1000 },
        ],
      },
      { name: '食費', total: 5000, children: [] },
    ]);
  });
  it('消したカテゴリの記録も、そのままの名前で出る', () => {
    expect(groupByParent({ 昔のカテゴリ: 100 }, cats)).toEqual([{ name: '昔のカテゴリ', total: 100, children: [] }]);
  });
});

describe('parentName / categoryTreeText', () => {
  it('親の名前と、親子をまとめた1行', () => {
    expect(parentName(cats, '服')).toBe('日用品');
    expect(parentName(cats, '食費')).toBeNull();
    expect(categoryTreeText(cats.filter((c) => c.type === 'expense'))).toBe('食費 / 日用品（服・雑貨） / 交通費');
  });
});

describe('parseEntry と子カテゴリ', () => {
  it('子の名前でも、「親 子」の順でも子として記録する', () => {
    expect(parseEntry('服 3000', cats)).toMatchObject({ category: '服', amount: 3000, memo: '' });
    expect(parseEntry('日用品 服 3000', cats)).toMatchObject({ category: '服', amount: 3000, memo: '' });
    expect(parseEntry('日用品 ハンガー 500', cats)).toMatchObject({ category: '日用品', memo: 'ハンガー' });
  });
  it('キーワードが同じ長さなら、子カテゴリを優先する', () => {
    const withKw = [
      { ...cat(7, '衣服'), keywords: 'ユニクロ' },
      { ...cat(5, '服', 2), keywords: 'ユニクロ' },
      cat(2, '日用品'),
    ];
    expect(parseEntry('ユニクロ 2000', withKw)).toMatchObject({ category: '服' });
  });
});
