import type { Repo } from './db';
import { assetSummary } from './assets';
import { monthOf, shiftMonth } from './util';

/**
 * 貯金の目標（Issue #18 段階3）。今いくら貯まっているかは、口座をつないでいればその残高の合計、
 * つないでいなければユーザーか AI が入れた額
 */
export interface Goal {
  id: number;
  name: string;
  /** 目標の額（円） */
  target: number;
  /** 今貯まっている額（円）。口座をつないでいるときは使わない */
  saved: number;
  /** つないだ口座（accounts.id） */
  accountIds: number[];
  /** 期限 'YYYY-MM'。なければ '' */
  deadline: string;
  memo: string;
}

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 画面や AI からの入力の型と範囲をそろえる */
/** 配列か、DB の JSON 文字列から、重ならない正の整数を10個まで */
function accountIdsOf(v: unknown): number[] {
  let list: unknown = v;
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? [...new Set(list.map(int).filter((n) => n > 0))].slice(0, 10) : [];
}

export function sanitizeGoal(input: Record<string, unknown>): Goal {
  const deadline = typeof input.deadline === 'string' ? input.deadline.slice(0, 7) : '';
  return {
    id: int(input.id),
    name: (typeof input.name === 'string' ? input.name.trim() : '').slice(0, 30) || '目標',
    target: int(input.target),
    saved: int(input.saved),
    accountIds: accountIdsOf(input.accountIds ?? input.account_ids),
    deadline: /^\d{4}-(0[1-9]|1[0-2])$/.test(deadline) ? deadline : '',
    memo: (typeof input.memo === 'string' ? input.memo.trim() : '').slice(0, 100),
  };
}

export function sameGoal(a: Goal, b: Goal): boolean {
  return (
    a.name === b.name &&
    a.target === b.target &&
    a.saved === b.saved &&
    a.accountIds.join() === b.accountIds.join() &&
    a.deadline === b.deadline &&
    a.memo === b.memo
  );
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/**
 * 直近の月の収支（収入 − 支出）の平均。記録が1件もない月は数えない。
 * 数える月がなければ null
 */
export function averageSurplus(months: { income: number; expense: number }[]): number | null {
  const used = months.filter((m) => m.income || m.expense);
  if (!used.length) return null;
  return Math.round(used.reduce((t, m) => t + m.income - m.expense, 0) / used.length);
}

/**
 * 目標までの見通し。
 * - perMonth：期限までに届くには、毎月いくら貯めればよいか（今月から期限の月まで）
 * - reachMonth：今の収支のペースで貯めたら、いつ届くか（ペースが0以下なら null）
 */
export function goalPlan(goal: Goal, thisMonth: string, surplus: number | null) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const monthsLeft = goal.deadline ? Math.max(1, monthIndex(goal.deadline) - monthIndex(thisMonth) + 1) : null;
  const perMonth = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
  const reachMonth =
    remaining === 0
      ? thisMonth
      : surplus && surplus > 0
        ? shiftMonth(thisMonth, Math.ceil(remaining / surplus) - 1)
        : null;
  return {
    remaining,
    progress: goal.target ? Math.min(1, goal.saved / goal.target) : 0,
    monthsLeft,
    perMonth,
    reachMonth,
    onTrack: perMonth === null || surplus === null ? null : surplus >= perMonth,
  };
}

/** 今貯まっている額。口座をつないでいれば、その今の残高の合計（借金の口座は数えない） */
export function savedOf(goal: Goal, accounts: { id: number; kind: string; balance: number }[]): number {
  if (!goal.accountIds.length) return goal.saved;
  return accounts.filter((a) => goal.accountIds.includes(a.id) && a.kind !== 'debt').reduce((t, a) => t + a.balance, 0);
}

/** 目標と見通しを、直近3か月（今月を除く）の収支から出す。画面と AI で同じものを使う */
export async function loadGoals(repo: Repo, userId: string, today: string) {
  const thisMonth = monthOf(today);
  const [goals, basis, accounts, balances] = await Promise.all([
    repo.goals(userId),
    repo.trend(userId, shiftMonth(thisMonth, -1), 3),
    repo.accounts(userId),
    repo.balances(userId),
  ]);
  const monthlySurplus = averageSurplus(basis);
  const now = assetSummary(accounts, balances, thisMonth, 1).accounts;
  return {
    monthlySurplus,
    basis,
    goals: goals.map((g) => {
      const current = { ...g, saved: savedOf(g, now) };
      return { ...current, ...goalPlan(current, thisMonth, monthlySurplus) };
    }),
  };
}
