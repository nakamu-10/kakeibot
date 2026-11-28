import type { assetSummary } from './assets';
import { monthlyAmount, monthlyTotal, type FixedCost } from './fixed';
import type { loadGoals } from './goals';
import { shiftMonth } from './util';

/**
 * 相談のまとめ（Issue #18 段階5）。毎月いくら回せるか・目標からの逆算・資産の分け方・推移・使い方を、
 * AI がひとつのツールで考え始められるように、家計・固定費・目標・資産の数字を集める
 */

interface MonthRecord {
  month: string;
  income: number;
  /** 使ったお金（貯金・投資を除く） */
  expense: number;
  /** 貯金・投資に回したお金 */
  saving: number;
  /** 親カテゴリでまとめた支出（貯金・投資を除く） */
  byCategory: Record<string, number>;
}

interface OverviewInput {
  thisMonth: string;
  /** 今月を除く直近の月（古い順） */
  months: MonthRecord[];
  /** 貯金・投資のカテゴリの名前 */
  savings: Set<string>;
  fixedCosts: FixedCost[];
  budget: number;
  categoryBudgets: { categoryName: string; amount: number }[];
  goals: Awaited<ReturnType<typeof loadGoals>>;
  assets: ReturnType<typeof assetSummary>;
}

const monthLabel = (month: string) => `${Number(month.slice(5, 7))}月`;

export function financialOverview(input: OverviewInput) {
  const { thisMonth, months, savings, fixedCosts, budget, goals, assets } = input;
  // 記録が1件もない月は、平均に入れない（使い始める前の月）
  const used = months.filter((m) => m.income || m.expense || m.saving);
  const avg = (pick: (m: MonthRecord) => number) =>
    used.length ? Math.round(used.reduce((t, m) => t + pick(m), 0) / used.length) : 0;
  const income = avg((m) => m.income);
  const expense = avg((m) => m.expense);
  const saving = avg((m) => m.saving);

  const names = [...new Set(used.flatMap((m) => Object.keys(m.byCategory)))];
  const spending = names
    .map((name) => {
      const average = avg((m) => m.byCategory[name] ?? 0);
      const catBudget = input.categoryBudgets.find((b) => b.categoryName === name);
      return {
        name,
        average,
        share: expense ? Math.round((average / expense) * 1000) / 1000 : 0,
        budget: catBudget?.amount ?? null,
      };
    })
    .sort((a, b) => b.average - a.average);

  // NISA の積立のような固定費は、使ったお金ではないので、固定費の合計と割合には入れない
  const fixedTotal = monthlyTotal(fixedCosts.filter((f) => !savings.has(f.category)));
  // 生活費の何か月分を、すぐ使える預金・現金で持っているか
  const liquid = assets.accounts.filter((a) => a.kind === 'savings' && a.active).reduce((t, a) => t + a.balance, 0);
  const history = assets.history;

  return {
    period: { months: months.map((m) => m.month), usedMonths: used.length },
    monthly: { income, expense, saving, surplus: income - expense, leftAfterSaving: income - expense - saving },
    spendingByCategory: spending,
    fixedCosts: {
      monthlyTotal: fixedTotal,
      shareOfExpense: expense ? Math.round((fixedTotal / expense) * 1000) / 1000 : null,
      items: fixedCosts
        .filter((f) => f.active)
        .map((f) => ({
          name: f.name,
          category: f.category,
          monthly: monthlyAmount(f),
          autoRecord: f.autoRecord,
          saving: savings.has(f.category),
        })),
    },
    budget: budget ? { amount: budget, minusAverageExpense: budget - expense } : null,
    emergencyFund: expense && liquid ? { liquid, monthsOfExpenses: Math.round((liquid / expense) * 10) / 10 } : null,
    goals: {
      monthlySurplus: goals.monthlySurplus,
      totalPerMonth: goals.goals.reduce((t, g) => t + (g.perMonth ?? 0), 0),
      items: goals.goals.map((g) => ({
        name: g.name,
        target: g.target,
        saved: g.saved,
        deadline: g.deadline,
        perMonth: g.perMonth,
        reachMonth: g.reachMonth,
        onTrack: g.onTrack,
      })),
    },
    assets: {
      totals: assets.totals,
      allocation: assets.allocation,
      change: history.length
        ? {
            from: history[0].month,
            netWorth: (history.at(-1)?.netWorth ?? 0) - history[0].netWorth,
            contribution: history.reduce((t, h) => t + h.contribution, 0),
            marketGain: history.reduce((t, h) => t + h.marketGain, 0),
          }
        : null,
    },
    warnings: overviewWarnings(thisMonth, months, used.length, assets.accounts),
  };
}

/** 数字が実際とずれていそうなところ。AI が答える前に、ユーザーに確かめられるように */
function overviewWarnings(
  thisMonth: string,
  months: MonthRecord[],
  usedMonths: number,
  accounts: { name: string; active: boolean; month: string }[],
): string[] {
  const warnings: string[] = [];
  if (usedMonths < months.length) {
    warnings.push(
      `直近${months.length}か月のうち、記録がある月は${usedMonths}か月だけです。平均はその月だけで出しています。`,
    );
  }
  const noIncome = months.filter((m) => (m.expense || m.saving) && !m.income).map((m) => monthLabel(m.month));
  if (noIncome.length) {
    warnings.push(
      `${noIncome.join('・')}は収入の記録がありません。収入を記録していないと、毎月の余りが実際より少なく出ます。`,
    );
  }
  const lastMonth = shiftMonth(thisMonth, -1);
  for (const a of accounts.filter((x) => x.active)) {
    if (!a.month) warnings.push(`${a.name}の残高がまだ入っていません。`);
    else if (a.month < lastMonth) warnings.push(`${a.name}の残高は${monthLabel(a.month)}のままです。`);
  }
  return warnings;
}
