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

/** 使い方の分析に使う記録の列（created_at は D1 の datetime('now')、UTC の 'YYYY-MM-DD HH:MM:SS'） */
export interface InsightRow {
  date: string;
  category: string;
  memo: string;
  source: string;
  edit_count: number;
  created_at: string;
}

const OTHER_CATEGORIES = new Set(['その他', 'その他収入']);
const WEEKDAYS = '日月火水木金土';

/** UTC の 'YYYY-MM-DD HH:MM:SS' を、日本時間の日付にするための UNIX ミリ秒（9時間ずらしたもの）にする */
const toJstMs = (utc: string) => new Date(utc.replace(' ', 'T') + 'Z').getTime() + 9 * 3600_000;

/** 多い順に上位 n 件（名前と件数） */
function top(values: string[], n: number) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/**
 * 期間 [from, to]（日本時間の 'YYYY-MM-DD'）の記録から、アプリの直しどころを探す手がかりをまとめる。
 * 判定の外れ（「その他」・よく直すカテゴリ）、記録の付け方、記録を忘れやすい日を見る
 */
export function usageInsights(rows: InsightRow[], from: string, to: string) {
  const total = rows.length;
  const others = rows.filter((r) => OTHER_CATEGORIES.has(r.category));
  const edited = rows.filter((r) => r.edit_count > 0);

  // 記録のない日（記録の日付で見る）と、その曜日
  const recorded = new Set(rows.map((r) => r.date));
  const missingByWeekday = [0, 0, 0, 0, 0, 0, 0];
  let days = 0;
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    days++;
    const d = new Date(t);
    if (!recorded.has(d.toISOString().slice(0, 10))) missingByWeekday[d.getUTCDay()]++;
  }
  const missing = missingByWeekday.reduce((a, b) => a + b, 0);

  // 記録した日より前の日付の記録（あとからまとめて付けたもの）
  const late = rows.filter((r) => new Date(toJstMs(r.created_at)).toISOString().slice(0, 10) > r.date);

  return {
    period: { from, to, days },
    entries: total,
    bySource: top(
      rows.map((r) => r.source),
      10,
    ).map((s) => ({ source: s.name, count: s.count, share: pct(s.count, total) })),
    other: {
      count: others.length,
      share: pct(others.length, total),
      /** キーワードを足す候補（「その他」になった記録のよくあるメモ） */
      topMemos: top(others.map((r) => r.memo).filter(Boolean), 10),
    },
    edited: {
      count: edited.length,
      share: pct(edited.length, total),
      /** 直された記録の、今のカテゴリ（判定が外れやすいところ） */
      topCategories: top(
        edited.map((r) => r.category),
        5,
      ),
    },
    daysWithoutEntries: {
      count: missing,
      share: pct(missing, days),
      byWeekday: missingByWeekday.map((count, i) => ({ weekday: WEEKDAYS[i], count })),
    },
    recordedLater: { count: late.length, share: pct(late.length, total) },
  };
}
