import type { Category, EntryType } from './types';

/**
 * カテゴリは2段まで（親と子）。parentId が 0 なら一番上の段。
 * 記録にはカテゴリ名を1つ持たせ、集計は親でまとめて子の内訳を添える
 */

/** 親を並び順に並べ、それぞれの子をすぐ下に並べる */
export function orderCategories<T extends Pick<Category, 'id' | 'sort' | 'parentId'>>(cats: T[]): T[] {
  const bySort = (a: T, b: T) => a.sort - b.sort || a.id - b.id;
  const ids = new Set(cats.map((c) => c.id));
  // 親が消えている子は一番上の段として扱う
  const isTop = (c: T) => c.parentId === 0 || !ids.has(c.parentId);
  return cats
    .filter(isTop)
    .sort(bySort)
    .flatMap((p) => [p, ...cats.filter((c) => !isTop(c) && c.parentId === p.id).sort(bySort)]);
}

/** 親にできるか。できなければ理由（ユーザーに見せる文） */
export function parentError(
  cats: Pick<Category, 'id' | 'name' | 'type' | 'parentId'>[],
  self: { id: number; type: EntryType },
  parentId: number,
): string | null {
  if (parentId === 0) return null;
  if (parentId === self.id) return '自分自身を親にはできません';
  const parent = cats.find((c) => c.id === parentId);
  if (!parent) return '親カテゴリが見つかりません';
  if (parent.type !== self.type) return '支出と収入をまたいで親子にはできません';
  if (parent.parentId !== 0) return `「${parent.name}」は子カテゴリなので、親にはできません（2段まで）`;
  if (self.id && cats.some((c) => c.parentId === self.id)) {
    return '子カテゴリを持つカテゴリは、ほかのカテゴリの下に入れられません（2段まで）';
  }
  return null;
}

export interface CategoryGroup {
  name: string;
  total: number;
  /** 子カテゴリの内訳（親そのものに付けた記録は「（親名）」として入る）。子がなければ空 */
  children: { name: string; amount: number }[];
}

/** カテゴリ別の金額を、親でまとめる（多い順） */
export function groupByParent(
  byCategory: Record<string, number>,
  cats: Pick<Category, 'id' | 'name' | 'parentId'>[],
): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup & { own: number }>();
  for (const [name, amount] of Object.entries(byCategory)) {
    const parent = parentName(cats, name);
    const key = parent ?? name;
    const g = groups.get(key) ?? { name: key, total: 0, children: [], own: 0 };
    g.total += amount;
    if (parent) g.children.push({ name, amount });
    else g.own += amount;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ own, ...g }) => {
      // 子がある親は、親そのものに付けた記録も内訳に出す
      if (g.children.length && own) g.children.push({ name: `（${g.name}）`, amount: own });
      g.children.sort((a, b) => b.amount - a.amount);
      return g;
    })
    .sort((a, b) => b.total - a.total);
}

/** 親の名前（一番上の段なら null） */
export function parentName(cats: Pick<Category, 'id' | 'name' | 'parentId'>[], name: string): string | null {
  const self = cats.find((c) => c.name === name);
  return (self?.parentId && cats.find((c) => c.id === self.parentId)?.name) || null;
}

/** 「食費 / 日用品（服・雑貨） / 交通費」のように、親と子をまとめて1行にする */
export function categoryTreeText(cats: Pick<Category, 'id' | 'name' | 'sort' | 'parentId'>[]): string {
  const ordered = orderCategories(cats);
  return ordered
    .filter((c) => !ordered.some((p) => p.id === c.parentId))
    .map((p) => {
      const children = ordered.filter((c) => c.parentId === p.id).map((c) => c.name);
      return children.length ? `${p.name}（${children.join('・')}）` : p.name;
    })
    .join(' / ');
}

/** そのカテゴリの子（並び順）。子でないか、子がなければ空 */
export function childrenOf<T extends Pick<Category, 'id' | 'name' | 'sort' | 'parentId'>>(
  cats: T[],
  name: string,
): T[] {
  const self = cats.find((c) => c.name === name && c.parentId === 0);
  if (!self) return [];
  return cats.filter((c) => c.parentId === self.id).sort((a, b) => a.sort - b.sort || a.id - b.id);
}
