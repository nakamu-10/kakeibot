import { Repo } from './db';
import { recordsOn } from './fixed';
import type { Env } from './types';
import { todayJST } from './util';

/**
 * 払う日の固定費を家計簿に記録する（Cron から毎朝呼ぶ）。
 * 日付も金額も決まっているので、仕送りと同じく記録だけして通知しない
 */
export async function runFixedCosts(env: Env, now: Date): Promise<void> {
  const repo = new Repo(env.DB);
  const today = todayJST(now);
  for (const f of (await repo.autoFixedCosts()).filter((f) => recordsOn(f, today))) {
    try {
      await repo.recordFixedCost(f.userId, f, today);
    } catch (e) {
      // 1件の失敗で、ほかの固定費の記録を止めない
      console.error('fixed cost failed', e instanceof Error ? e.message : e);
    }
  }
}
