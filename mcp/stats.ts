import type { CategoryGroup } from '../src/category';
import type { Category } from '../src/types';
import { daysInMonth, monthOf } from '../src/util';

/**
 * 予算に対する今月のペース。month が今月でなければ、その月はもう終わった（または始まっていない）ものとして扱う
 */
export function budgetStatus(month: string, today: string, spent: number, budget: number) {
  const days = daysInMonth(month);
  const current = monthOf(today);
  const daysPassed = month < current ? days : month > current ? 0 : Number(today.slice(8, 10));
  const dailyAverage = daysPassed ? Math.round(spent / daysPassed) : 0;
  const daysLeft = days - daysPassed;
  return {
    month,
    budget: budget || null,
    spent,
    remaining: budget ? budget - spent : null,
    daysInMonth: days,
    daysPassed,
    dailyAverage,
    /** このペースで月末まで使ったときの支出 */
    projectedTotal: daysPassed ? Math.round((spent / daysPassed) * days) : spent,
    /** 残りの日に、1日いくらまでなら予算に収まるか（今日の分を含む） */
    safeDailySpend: budget && daysLeft > 0 ? Math.max(0, Math.floor((budget - spent) / (daysLeft + 1))) : null,
  };
}

/** 2つの月のカテゴリ別（親でまとめたもの）を並べ、差の大きい順にする */
export function compareGroups(a: CategoryGroup[], b: CategoryGroup[]) {
  const names = [...new Set([...a.map((g) => g.name), ...b.map((g) => g.name)])];
  return names
    .map((name) => {
      const amountA = a.find((g) => g.name === name)?.total ?? 0;
      const amountB = b.find((g) => g.name === name)?.total ?? 0;
      return { category: name, monthA: amountA, monthB: amountB, diff: amountB - amountA };
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}

/** AI がカテゴリを選べるように、親子をまとめた一覧にする */
export function categoryTree(cats: Pick<Category, 'id' | 'name' | 'type' | 'keywords' | 'parentId'>[]) {
  const tops = cats.filter((c) => !c.parentId || !cats.some((p) => p.id === c.parentId));
  return tops.map((p) => ({
    name: p.name,
    type: p.type,
    keywords: p.keywords,
    children: cats.filter((c) => c.parentId === p.id).map((c) => ({ name: c.name, keywords: c.keywords })),
  }));
}
