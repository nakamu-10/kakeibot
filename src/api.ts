import type { Env, EntryType } from './types';
import { Repo } from './db';
import { verifyIdToken } from './line';
import { monthOf, todayJST } from './util';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

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
    const [summary, trend, budget, categories] = await Promise.all([
      repo.monthSummary(userId, month),
      repo.trend(userId, month, 6),
      repo.budget(userId),
      repo.categories(userId),
    ]);
    return json({ ...summary, trend, budget, categories, today: todayJST() });
  }

  // 予算
  if (method === 'PUT' && path === '/budget') {
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    await repo.setBudget(userId, amount);
    return json({ ok: true, budget: amount });
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
    try {
      await repo.addCategory(userId, name, type, str(body.keywords));
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
      await repo.updateCategory(userId, id, {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 20) : undefined,
        keywords: typeof body.keywords === 'string' ? body.keywords : undefined,
      });
      return json({ ok: true });
    }
  }

  // CSVエクスポート（Excel で文字化けしないよう BOM 付き）
  if (method === 'GET' && path === '/export.csv') {
    const rows = await repo.allEntries(userId);
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv =
      '﻿日付,種別,カテゴリ,金額,店名,メモ,入力方法\n' +
      rows
        .map((r) =>
          [r.date, r.type === 'income' ? '収入' : '支出', r.category, r.amount, r.store, r.memo, r.source]
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

  return json({ error: 'not found' }, 404);
}
