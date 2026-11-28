import type { Env, EntryType } from './types';
import { Repo } from './db';
import { verifyIdToken } from './line';
import { json, monthOf, shiftMonth, todayJST } from './util';
import { findRecurring, monthlyTotal, sanitizeFixedCost } from './fixed';
import { undoBatch } from './changes';
import { groupByParent, orderCategories, parentError, parentName } from './category';
import { handleShiftApi } from './shift/api';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** LIFF画面から呼ばれるAPI（/api/...） */
export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const userId = token ? await verifyIdToken(env, token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const repo = new Repo(env.DB);
  await repo.ensureUser(userId);
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method;
  const body =
    method === 'GET' || method === 'DELETE' ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

  // 月のダッシュボード
  if (method === 'GET' && path === '/summary') {
    const q = url.searchParams.get('month') ?? '';
    const month = /^\d{4}-\d{2}$/.test(q) ? q : monthOf(todayJST());
    const [summary, trend, budget, categories, remind, changes, fixed] = await Promise.all([
      repo.monthSummary(userId, month),
      repo.trend(userId, month, 6),
      repo.budget(userId),
      repo.categories(userId),
      repo.remind(userId),
      repo.changeBatches(userId, 10),
      repo.fixedCosts(userId),
    ]);
    return json({
      ...summary,
      // 親でまとめたカテゴリ別（画面で同じ計算を持たないように、ここで作る）
      groups: groupByParent(summary.byCategory, categories),
      trend,
      budget,
      categories: orderCategories(categories),
      remind,
      changes,
      fixedCosts: { items: fixed, monthlyTotal: monthlyTotal(fixed) },
      today: todayJST(),
    });
  }

  // 予算
  if (method === 'PUT' && path === '/budget') {
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    await repo.setBudget(userId, amount);
    return json({ ok: true, budget: amount });
  }

  // 固定費・サブスク（画面からの変更は人が見ているので、変更の履歴には残さない。ADR 0012）
  if (method === 'GET' && path === '/fixed/candidates') {
    const from = `${shiftMonth(monthOf(todayJST()), -5)}-01`;
    const [entries, registered] = await Promise.all([repo.expensesSince(userId, from), repo.fixedCosts(userId)]);
    return json(findRecurring(entries, registered));
  }
  if (method === 'POST' && path === '/fixed') {
    const f = sanitizeFixedCost(body);
    if (!f.amount) return json({ error: '金額を入れてください' }, 400);
    if (f.id && !(await repo.getFixedCost(userId, f.id)))
      return json({ error: 'その固定費は見つかりませんでした' }, 404);
    return json(await repo.saveFixedCost(userId, f));
  }
  const fixedMatch = path.match(/^\/fixed\/(\d+)$/);
  if (method === 'DELETE' && fixedMatch) {
    await repo.deleteFixedCost(userId, Number(fixedMatch[1]));
    return json({ ok: true });
  }

  // AI による変更の取り消し
  if (method === 'POST' && path === '/changes/undo') {
    const batch = str(body.batch);
    const changes = batch ? await repo.changesOf(userId, batch) : [];
    if (!changes.length) return json({ error: 'その変更は見つかりませんでした' }, 404);
    const outcome = await undoBatch(repo, userId, changes);
    await repo.markUndone(userId, batch);
    return json({ ok: true, ...outcome });
  }

  // 記録忘れ通知
  if (method === 'PUT' && path === '/remind') {
    await repo.setRemind(userId, body.on === true);
    return json({ ok: true, remind: body.on === true });
  }

  // 記録の追加・編集・削除
  if (method === 'POST' && path === '/entries') {
    const type = body.type === 'income' ? 'income' : 'expense';
    const amount = Math.round(Number(body.amount) || 0);
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayJST();
    if (amount <= 0 || typeof body.category !== 'string') return json({ error: 'invalid' }, 400);
    const id = await repo.addEntry(userId, {
      type,
      category: body.category,
      amount,
      memo: str(body.memo),
      date,
      source: 'app',
    });
    return json({ ok: true, id });
  }
  const entryMatch = path.match(/^\/entries\/(\d+)$/);
  if (entryMatch) {
    const id = Number(entryMatch[1]);
    if (method === 'DELETE') return json({ ok: await repo.deleteEntry(userId, id) });
    if (method === 'PATCH') {
      await repo.updateEntry(userId, id, {
        type: body.type === 'income' || body.type === 'expense' ? body.type : undefined,
        category: typeof body.category === 'string' ? body.category : undefined,
        amount: body.amount != null ? Math.round(Number(body.amount)) : undefined,
        memo: typeof body.memo === 'string' ? body.memo : undefined,
        date: typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined,
      });
      return json({ ok: true });
    }
  }

  // カテゴリ
  if (method === 'POST' && path === '/categories') {
    const name = str(body.name).trim().slice(0, 20);
    const type: EntryType = body.type === 'income' ? 'income' : 'expense';
    if (!name) return json({ error: 'invalid' }, 400);
    const parentId = Number(body.parentId) || 0;
    const error = parentError(await repo.categories(userId), { id: 0, type }, parentId);
    if (error) return json({ error }, 400);
    try {
      await repo.addCategory(userId, name, type, str(body.keywords), parentId);
    } catch {
      return json({ error: '同じ名前のカテゴリがあります' }, 409);
    }
    return json({ ok: true });
  }
  if (method === 'PUT' && path === '/categories/order') {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    await repo.reorderCategories(userId, ids);
    return json({ ok: true });
  }
  const catMatch = path.match(/^\/categories\/(\d+)$/);
  if (catMatch) {
    const id = Number(catMatch[1]);
    if (method === 'DELETE') {
      await repo.deleteCategory(userId, id);
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const parentId = body.parentId == null ? undefined : Number(body.parentId) || 0;
      if (parentId !== undefined) {
        const cats = await repo.categories(userId);
        const self = cats.find((c) => c.id === id);
        if (!self) return json({ error: 'not found' }, 404);
        const error = parentError(cats, self, parentId);
        if (error) return json({ error }, 400);
      }
      await repo.updateCategory(userId, id, {
        parentId,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 20) : undefined,
        keywords: typeof body.keywords === 'string' ? body.keywords : undefined,
      });
      return json({ ok: true });
    }
  }

  // CSVエクスポート（Excel で文字化けしないよう BOM 付き）
  if (method === 'GET' && path === '/export.csv') {
    const [rows, cats] = await Promise.all([repo.allEntries(userId), repo.categories(userId)]);
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv =
      '﻿日付,種別,親カテゴリ,カテゴリ,金額,店名,メモ,入力方法\n' +
      rows
        .map((r) =>
          [
            r.date,
            r.type === 'income' ? '収入' : '支出',
            parentName(cats, r.category) ?? '',
            r.category,
            r.amount,
            r.store,
            r.memo,
            r.source,
          ]
            .map(esc)
            .join(','),
        )
        .join('\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="kakeibo.csv"',
      },
    });
  }

  if (path.startsWith('/shift/')) return handleShiftApi(env, repo, userId, method, path, body, url);

  return json({ error: 'not found' }, 404);
}
