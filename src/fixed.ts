/**
 * 固定費・サブスク（Issue #18 段階2）。家賃・スマホ・サブスクのように、決まって出ていくお金。
 * 登録するだけで、家計簿には自動で記録しない（口座から払って手でも記録していると二重になるため）
 */

type Cycle = 'monthly' | 'yearly';

export interface FixedCost {
  id: number;
  name: string;
  amount: number;
  /** 支出のカテゴリ名 */
  category: string;
  cycle: Cycle;
  /** 払う日（31は月末） */
  day: number;
  /** 毎年のとき、払う月（1〜12）。毎月なら 0 */
  month: number;
  /** やめたけれど記録として残しておくものは false */
  active: boolean;
  memo: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, def: number) => {
  const n = Number(v);
  return v === '' || v == null || !Number.isFinite(n) ? def : n;
};

/** 画面や AI からの入力の型と範囲をそろえる */
export function sanitizeFixedCost(input: Record<string, unknown>): FixedCost {
  const cycle: Cycle = input.cycle === 'yearly' ? 'yearly' : 'monthly';
  return {
    id: num(input.id, 0),
    name: (typeof input.name === 'string' ? input.name.trim() : '').slice(0, 30) || '固定費',
    amount: Math.max(0, Math.round(num(input.amount, 0))),
    category: typeof input.category === 'string' ? input.category : 'その他',
    cycle,
    day: clamp(Math.round(num(input.day, 1)), 1, 31),
    month: cycle === 'yearly' ? clamp(Math.round(num(input.month, 1)), 1, 12) : 0,
    active: input.active !== false,
    memo: (typeof input.memo === 'string' ? input.memo.trim() : '').slice(0, 100),
  };
}

/** 毎月かかる額にならす（毎年なら12で割る） */
export const monthlyAmount = (f: Pick<FixedCost, 'amount' | 'cycle'>) =>
  f.cycle === 'yearly' ? Math.round(f.amount / 12) : f.amount;

/** やめていない固定費の、毎月かかる額の合計 */
export const monthlyTotal = (list: Pick<FixedCost, 'amount' | 'cycle' | 'active'>[]) =>
  list.filter((f) => f.active).reduce((t, f) => t + monthlyAmount(f), 0);

export function sameFixedCost(a: FixedCost, b: FixedCost): boolean {
  return (
    a.name === b.name &&
    a.amount === b.amount &&
    a.category === b.category &&
    a.cycle === b.cycle &&
    a.day === b.day &&
    a.month === b.month &&
    a.active === b.active &&
    a.memo === b.memo
  );
}

interface PaidEntry {
  date: string;
  category: string;
  amount: number;
  memo: string;
  store: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * 記録から、毎月のように出ている支払い（固定費・サブスクの候補）を見つける。
 * 同じ店名かメモ・同じカテゴリで、2か月以上、ほぼ同じ金額（中央値から1割以内）、月に1回ほど。
 * 登録済みの固定費と名前が重なるものは除く
 */
export function findRecurring(entries: PaidEntry[], registered: Pick<FixedCost, 'name'>[]) {
  const groups = new Map<string, { name: string; category: string; items: PaidEntry[] }>();
  for (const e of entries) {
    const name = (e.store || e.memo).trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}|${e.category}`;
    const g = groups.get(key) ?? { name, category: e.category, items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  const known = registered.map((r) => r.name.toLowerCase());
  return [...groups.values()]
    .flatMap((g) => {
      const months = new Set(g.items.map((e) => e.date.slice(0, 7)));
      const amount = median(g.items.map((e) => e.amount));
      const steady = g.items.every((e) => Math.abs(e.amount - amount) <= amount * 0.1);
      const lower = g.name.toLowerCase();
      const isKnown = known.some((k) => lower.includes(k) || k.includes(lower));
      if (months.size < 2 || !steady || g.items.length > months.size * 1.5 || isKnown) return [];
      return [
        {
          name: g.name,
          category: g.category,
          amount,
          months: months.size,
          lastDate:
            g.items
              .map((e) => e.date)
              .sort()
              .at(-1) ?? '',
        },
      ];
    })
    .sort((a, b) => b.months - a.months || b.amount - a.amount)
    .slice(0, 20);
}
