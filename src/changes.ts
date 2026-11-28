import type { Repo } from './db';
import { sameFixedCost, type FixedCost } from './fixed';
import { sameGoal, type Goal } from './goals';
import { ACCOUNT_KINDS, sameAccount, type Account, type Balance } from './assets';
import type { Entry } from './types';
import { yen } from './util';

/**
 * AI が家計簿を変えたときの履歴と、取り消し（Issue #18 段階1）。
 * 1回の依頼（ツールの1回の呼び出し）で変えたものを、同じ batch にまとめて残す
 */

export type ChangeTarget = 'entry' | 'budget' | 'fixed_cost' | 'goal' | 'account' | 'balance';
export type ChangeOp = 'insert' | 'update' | 'delete';

export interface Change {
  target: ChangeTarget;
  targetId: number;
  op: ChangeOp;
  /** 変える前（insert なら null） */
  before: unknown;
  /** 変えたあと（delete なら null） */
  after: unknown;
  summary: string;
}

/** 記録の、取り消しで見比べる中身 */
type EntryFields = Pick<Entry, 'type' | 'category' | 'amount' | 'memo' | 'date'>;

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const label = (e: EntryFields) => `${e.category} ${yen(e.amount)}（${md(e.date)}${e.memo ? ` ${e.memo}` : ''}）`;

export function entryChange(op: ChangeOp, before: Entry | null, after: Entry | null): Change {
  const id = (after ?? before)?.id ?? 0;
  const summary =
    op === 'insert' && after
      ? `追加：${label(after)}`
      : op === 'delete' && before
        ? `削除：${label(before)}`
        : before && after
          ? `変更：${label(before)} → ${label(after)}`
          : '';
  return { target: 'entry', targetId: id, op, before, after, summary };
}

export function budgetChange(before: number, after: number): Change {
  const show = (n: number) => (n ? yen(n) : 'なし');
  return {
    target: 'budget',
    targetId: 0,
    op: 'update',
    before: { amount: before },
    after: { amount: after },
    summary: `予算：${show(before)} → ${show(after)}`,
  };
}

export function fixedCostChange(op: ChangeOp, before: FixedCost | null, after: FixedCost | null): Change {
  const show = (f: FixedCost) =>
    `${f.name} ${yen(f.amount)}/${f.cycle === 'yearly' ? '年' : '月'}${f.active ? '' : '（やめた）'}`;
  const summary =
    op === 'insert' && after
      ? `固定費を追加：${show(after)}`
      : op === 'delete' && before
        ? `固定費を削除：${show(before)}`
        : before && after
          ? `固定費を変更：${show(before)} → ${show(after)}`
          : '';
  return { target: 'fixed_cost', targetId: (after ?? before)?.id ?? 0, op, before, after, summary };
}

export function goalChange(op: ChangeOp, before: Goal | null, after: Goal | null): Change {
  const show = (g: Goal) =>
    `${g.name} ${g.accountIds.length ? `口座${g.accountIds.length}つから` : yen(g.saved)}/${yen(g.target)}${g.deadline ? `（${g.deadline.slice(0, 4)}年${Number(g.deadline.slice(5, 7))}月まで）` : ''}`;
  const summary =
    op === 'insert' && after
      ? `目標を追加：${show(after)}`
      : op === 'delete' && before
        ? `目標を削除：${show(before)}`
        : before && after
          ? `目標を変更：${show(before)} → ${show(after)}`
          : '';
  return { target: 'goal', targetId: (after ?? before)?.id ?? 0, op, before, after, summary };
}

export function accountChange(op: ChangeOp, before: Account | null, after: Account | null): Change {
  const show = (a: Account) => `${a.name}（${ACCOUNT_KINDS[a.kind]}）${a.active ? '' : '・解約'}`;
  const summary =
    op === 'insert' && after
      ? `口座を追加：${show(after)}`
      : before && after
        ? `口座を変更：${show(before)} → ${show(after)}`
        : '';
  return { target: 'account', targetId: (after ?? before)?.id ?? 0, op, before, after, summary };
}

export function balanceChange(name: string, before: Balance | null, after: Balance): Change {
  const month = `${Number(after.month.slice(5, 7))}月`;
  const show = (b: Balance) => yen(b.balance) + (b.contribution ? `（入れた額 ${yen(b.contribution)}）` : '');
  return {
    target: 'balance',
    targetId: after.accountId,
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `${name}の${month}の残高：${before ? `${show(before)} → ` : ''}${show(after)}`,
  };
}

/** 固定費や目標のように、id で読み書きするもの */
interface RecordStore<T> {
  get(id: number): Promise<T | null>;
  same(a: T, b: T): boolean;
  remove(id: number): Promise<void>;
  restore(value: T): Promise<void>;
  save(value: T): Promise<unknown>;
}

/** 1件を元に戻す。その後に変わっていたら戻さずに false */
async function undoRecord<T>(store: RecordStore<T>, c: StoredChange): Promise<boolean> {
  const current = await store.get(c.targetId);
  const untouched = c.op === 'delete' ? !current : current !== null && store.same(current, c.after as T);
  if (!untouched) return false;
  if (c.op === 'insert') await store.remove(c.targetId);
  else if (c.op === 'delete') await store.restore(c.before as T);
  else await store.save(c.before as T);
  return true;
}

/** 記録が、変えたあとのまま（その後に誰も直していない）か */
export function sameEntry(current: EntryFields, expected: EntryFields): boolean {
  return (
    current.type === expected.type &&
    current.category === expected.category &&
    current.amount === expected.amount &&
    current.memo === expected.memo &&
    current.date === expected.date
  );
}

export interface StoredChange extends Change {
  id: number;
}

/**
 * 1回分の変更を、後ろから順に元に戻す。
 * その後にほかから直された（今が「変えたあと」と違う）ものは戻さずに skipped に入れる
 */
export async function undoBatch(
  repo: Repo,
  userId: string,
  changes: StoredChange[],
): Promise<{ undone: string[]; skipped: string[] }> {
  const undone: string[] = [];
  const skipped: string[] = [];
  const stores = {
    fixed_cost: {
      get: (id) => repo.getFixedCost(userId, id),
      same: sameFixedCost,
      remove: (id) => repo.deleteFixedCost(userId, id),
      restore: (f) => repo.restoreFixedCost(userId, f),
      save: (f) => repo.saveFixedCost(userId, f),
    } satisfies RecordStore<FixedCost>,
    goal: {
      get: (id) => repo.getGoal(userId, id),
      same: sameGoal,
      remove: (id) => repo.deleteGoal(userId, id),
      restore: (g) => repo.restoreGoal(userId, g),
      save: (g) => repo.saveGoal(userId, g),
    } satisfies RecordStore<Goal>,
    account: {
      get: (id) => repo.getAccount(userId, id),
      same: sameAccount,
      // 追加を取り消すときは、その後に入れた残高も消える
      remove: (id) => repo.deleteAccount(userId, id),
      restore: (a) => repo.restoreAccount(userId, a),
      save: (a) => repo.saveAccount(userId, a),
    } satisfies RecordStore<Account>,
  };
  for (const c of [...changes].sort((a, b) => b.id - a.id)) {
    if (c.target === 'budget') {
      const before = (c.before as { amount: number }).amount;
      const after = (c.after as { amount: number }).amount;
      if ((await repo.budget(userId)) !== after) {
        skipped.push(`${c.summary}（その後に予算が変わったので戻していません）`);
        continue;
      }
      await repo.setBudget(userId, before);
      undone.push(c.summary);
      continue;
    }
    if (c.target === 'balance') {
      const after = c.after as Balance;
      const before = c.before as Balance | null;
      const current = await repo.getBalance(userId, after.accountId, after.month);
      if (!current || current.balance !== after.balance || current.contribution !== after.contribution) {
        skipped.push(`${c.summary}（その後に変わったので戻していません）`);
        continue;
      }
      if (before) await repo.setBalance(userId, before);
      else await repo.deleteBalance(userId, after.accountId, after.month);
      undone.push(c.summary);
      continue;
    }
    if (c.target === 'fixed_cost' || c.target === 'goal' || c.target === 'account') {
      const ok =
        c.target === 'goal'
          ? await undoRecord(stores.goal, c)
          : c.target === 'account'
            ? await undoRecord(stores.account, c)
            : await undoRecord(stores.fixed_cost, c);
      if (ok) undone.push(c.summary);
      else skipped.push(`${c.summary}（その後に変わったので戻していません）`);
      continue;
    }
    const current = await repo.getEntry(userId, c.targetId);
    if (c.op === 'delete') {
      if (current) {
        skipped.push(`${c.summary}（もう同じ記録があります）`);
        continue;
      }
      await repo.restoreEntry(userId, c.before as Entry);
    } else {
      if (!current || !sameEntry(current, c.after as Entry)) {
        skipped.push(`${c.summary}（その後に直されたか消されたので戻していません）`);
        continue;
      }
      if (c.op === 'insert') await repo.deleteEntry(userId, c.targetId);
      else await repo.updateEntry(userId, c.targetId, c.before as Entry);
    }
    undone.push(c.summary);
  }
  return { undone, skipped };
}
