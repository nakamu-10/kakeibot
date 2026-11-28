import type { Repo } from './db';
import { sameFixedCost, type FixedCost } from './fixed';
import type { Entry } from './types';
import { yen } from './util';

/**
 * AI が家計簿を変えたときの履歴と、取り消し（Issue #18 段階1）。
 * 1回の依頼（ツールの1回の呼び出し）で変えたものを、同じ batch にまとめて残す
 */

export type ChangeTarget = 'entry' | 'budget' | 'fixed_cost';
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
    if (c.target === 'fixed_cost') {
      const current = await repo.getFixedCost(userId, c.targetId);
      const ok = c.op === 'delete' ? !current : current !== null && sameFixedCost(current, c.after as FixedCost);
      if (!ok) {
        skipped.push(`${c.summary}（その後に変わったので戻していません）`);
        continue;
      }
      if (c.op === 'insert') await repo.deleteFixedCost(userId, c.targetId);
      else if (c.op === 'delete') await repo.restoreFixedCost(userId, c.before as FixedCost);
      else await repo.saveFixedCost(userId, c.before as FixedCost);
      undone.push(c.summary);
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
