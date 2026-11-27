import { describe, expect, it } from 'vitest';
import { budgetChange, entryChange, sameEntry } from './changes';
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

describe('sameEntry', () => {
  it('取り消してよいのは、変えたあとから誰も直していないときだけ', () => {
    const sameButOtherIdAndStore: Entry = { ...lunch, id: 99, store: 'どこか' };
    expect(sameEntry(lunch, sameButOtherIdAndStore)).toBe(true);
    expect(sameEntry({ ...lunch, amount: 1000 }, lunch)).toBe(false);
    expect(sameEntry({ ...lunch, category: '交際費' }, lunch)).toBe(false);
  });
});
