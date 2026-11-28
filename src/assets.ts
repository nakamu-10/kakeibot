import { shiftMonth } from './util';

/**
 * 資産と借金（Issue #18 段階4）。口座ごとに、月に1回の残高を入れる。
 * 投資の口座では、その月に入れた額（積立など）も入れ、増えた分を「入れた分」と「値動き」に分ける
 */

export const ACCOUNT_KINDS = {
  savings: '預金・現金',
  nisa: 'NISA',
  ideco: 'iDeCo',
  securities: '証券（課税）',
  crypto: '暗号資産',
  other: 'その他の資産',
  debt: '借金',
} as const;

export type AccountKind = keyof typeof ACCOUNT_KINDS;

const INVESTMENT_KINDS = new Set<AccountKind>(['nisa', 'ideco', 'securities', 'crypto']);

/** 入れた額（積立など）を入れる口座か */
export const isInvestment = (kind: AccountKind) => INVESTMENT_KINDS.has(kind);

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  /** 解約した口座は false（これまでの残高は残す） */
  active: boolean;
  memo: string;
}

export interface Balance {
  accountId: number;
  /** 'YYYY-MM' */
  month: string;
  /** その月の残高。借金は返していない額を正の数で */
  balance: number;
  /** その月に入れた額（投資の口座だけ） */
  contribution: number;
}

const isKind = (v: unknown): v is AccountKind => typeof v === 'string' && v in ACCOUNT_KINDS;

/** 画面や AI からの入力の型と範囲をそろえる */
export function sanitizeAccount(input: Record<string, unknown>): Account {
  const id = Math.round(Number(input.id));
  return {
    id: Number.isFinite(id) && id > 0 ? id : 0,
    name: (typeof input.name === 'string' ? input.name.trim() : '').slice(0, 30) || '口座',
    kind: isKind(input.kind) ? input.kind : 'savings',
    active: input.active !== false,
    memo: (typeof input.memo === 'string' ? input.memo.trim() : '').slice(0, 100),
  };
}

export function sameAccount(a: Account, b: Account): boolean {
  return a.name === b.name && a.kind === b.kind && a.active === b.active && a.memo === b.memo;
}

/** その月の時点の残高（その月に入れていなければ、それより前でいちばん新しい残高） */
function balanceAt(balances: Balance[], accountId: number, month: string): Balance | undefined {
  return balances
    .filter((b) => b.accountId === accountId && b.month <= month)
    .reduce<Balance | undefined>((latest, b) => (!latest || b.month > latest.month ? b : latest), undefined);
}

/**
 * 資産のまとめ。
 * - accounts：口座ごとの今の残高と、それを入れた月（古ければ入れ直してもらう）
 * - totals：資産・借金・純資産（資産 − 借金）
 * - allocation：資産の種類ごとの額と割合
 * - history：月ごとの純資産と、投資の口座の「入れた額」と「値動き」（前の月からの増え − 入れた額）
 */
export function assetSummary(accounts: Account[], balances: Balance[], thisMonth: string, months = 12) {
  const now = accounts.map((a) => {
    const b = balanceAt(balances, a.id, thisMonth);
    return { ...a, balance: b?.balance ?? 0, month: b?.month ?? '' };
  });
  const sum = (list: typeof now) => list.reduce((t, a) => t + a.balance, 0);
  const assets = now.filter((a) => a.kind !== 'debt');
  const debts = now.filter((a) => a.kind === 'debt');
  const assetTotal = sum(assets);
  const allocation = (Object.keys(ACCOUNT_KINDS) as AccountKind[])
    .filter((kind) => kind !== 'debt')
    .map((kind) => {
      const amount = sum(assets.filter((a) => a.kind === kind));
      return {
        kind,
        label: ACCOUNT_KINDS[kind],
        amount,
        share: assetTotal ? Math.round((amount / assetTotal) * 1000) / 1000 : 0,
      };
    })
    .filter((x) => x.amount > 0);

  const history = Array.from({ length: months }, (_, i) => shiftMonth(thisMonth, i - months + 1)).map((month) => {
    let netWorth = 0;
    let contribution = 0;
    let marketGain = 0;
    for (const a of accounts) {
      const b = balanceAt(balances, a.id, month);
      if (!b) continue;
      netWorth += a.kind === 'debt' ? -b.balance : b.balance;
      // その月に入れていない口座は、前の月から動いていないものとして数える
      if (!isInvestment(a.kind) || b.month !== month) continue;
      const prev = balanceAt(balances, a.id, shiftMonth(month, -1));
      if (!prev) continue;
      contribution += b.contribution;
      marketGain += b.balance - prev.balance - b.contribution;
    }
    return { month, netWorth, contribution, marketGain };
  });

  return {
    accounts: now,
    totals: { assets: assetTotal, debts: sum(debts), netWorth: assetTotal - sum(debts) },
    allocation,
    history: history.filter((h, i) => h.netWorth !== 0 || history.slice(0, i).some((x) => x.netWorth !== 0)),
  };
}
