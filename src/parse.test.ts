import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, extractDate, parseEntry } from './parse';
import { parseReceiptJson } from './receipt';

const p = (s: string) => parseEntry(s, DEFAULT_CATEGORIES);

describe('parseEntry', () => {
  it('キーワードから自動判定', () => {
    expect(p('ランチ 800')).toEqual({ type: 'expense', category: '食費', amount: 800, memo: 'ランチ' });
    expect(p('スーパー 2,480')).toMatchObject({ category: '食費', amount: 2480 });
    expect(p('電車１２０円')).toMatchObject({ category: '交通費', amount: 120 });
    expect(p('コーヒー500')).toMatchObject({ category: '食費', amount: 500, memo: 'コーヒー' });
  });
  it('カテゴリ名を直接指定', () => {
    expect(p('食費 800')).toEqual({ type: 'expense', category: '食費', amount: 800, memo: '' });
    expect(p('趣味 ガンプラ 3000')).toEqual({ type: 'expense', category: '趣味', amount: 3000, memo: 'ガンプラ' });
  });
  it('金額が先', () => {
    expect(p('800 ランチ')).toMatchObject({ category: '食費', amount: 800 });
  });
  it('収入', () => {
    expect(p('+給料 50000')).toMatchObject({ type: 'income', category: '給与', amount: 50000 });
    expect(p('＋５００００')).toMatchObject({ type: 'income', category: 'その他収入', amount: 50000 });
    expect(p('収入 バイト 30000')).toMatchObject({ type: 'income', category: '給与' });
    expect(p('バイト代 42000')).toMatchObject({ type: 'income', category: '給与' });
  });
  it('不明はその他、金額なしはnull', () => {
    expect(p('謎の出費 999')).toMatchObject({ category: 'その他', amount: 999 });
    expect(p('こんにちは')).toBeNull();
  });
});

describe('extractDate', () => {
  it('相対・絶対日付', () => {
    expect(extractDate('昨日 ランチ 800', '2026-11-24')).toEqual({ date: '2026-11-23', rest: 'ランチ 800' });
    expect(extractDate('11/20 本 1200', '2026-11-24')).toEqual({ date: '2026-11-20', rest: '本 1200' });
    expect(extractDate('12/30 飲み会 4000', '2027-01-03').date).toBe('2026-12-30');
    expect(extractDate('ランチ 800', '2026-11-24').date).toBe('2026-11-24');
  });
});

describe('parseReceiptJson', () => {
  it('JSONを取り出して整形', () => {
    const r = parseReceiptJson('```json\n{"is_receipt":true,"store":"セブン","date":"2026-11-24","total":"648","category":"食費","items":[{"name":"おにぎり","price":150}]}\n```', ['食費', 'その他']);
    expect(r).toMatchObject({ isReceipt: true, store: 'セブン', total: 648, category: '食費' });
    expect(parseReceiptJson('{"is_receipt": false}', ['食費']).isReceipt).toBe(false);
    expect(parseReceiptJson('{"total": 100, "category": "謎"}', ['食費', 'その他']).category).toBe('その他');
  });
});
