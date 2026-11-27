import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { groupByParent } from '../src/category';
import { Repo } from '../src/db';
import { loadReport } from '../src/shift/report';
import { monthOf, todayJST } from '../src/util';
import type { McpEnv } from './env';
import { budgetStatus, categoryTree, compareGroups } from './stats';

const MONTH = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .describe('YYYY-MM（日本時間）。省略すると今月');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** 結果を JSON で返す（AI が読みやすいように、文章ではなく構造で） */
const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

/**
 * 家計簿の MCP サーバー（1リクエストごとに作る）。userId は LINE ログインで確かめた本人。
 * フェーズ1は読み取りだけ。金額は円の整数、日付は日本時間の 'YYYY-MM-DD'
 */
export function createServer(env: McpEnv, userId: string): McpServer {
  const repo = new Repo(env.DB);
  const server = new McpServer({ name: 'kakeibot', version: '0.1.0' });

  server.registerTool(
    'list_categories',
    {
      title: 'カテゴリの一覧',
      description:
        '家計簿のカテゴリ（支出・収入）を、親と子のまとまりで返す。keywords はトークで記録するときの自動判定に使う言葉。',
      annotations: READ_ONLY,
    },
    async () => result(categoryTree(await repo.categories(userId))),
  );

  server.registerTool(
    'search_entries',
    {
      title: '記録を探す',
      description:
        '条件に合う記録を新しい順に返す。count・expense・income は limit に関係なく条件に合うすべての件数と合計。' +
        'category に親カテゴリを渡すと、その子カテゴリの記録も含める。',
      inputSchema: z.object({
        from: DATE.optional().describe('この日以降（YYYY-MM-DD）'),
        to: DATE.optional().describe('この日まで（YYYY-MM-DD）'),
        category: z.string().optional().describe('カテゴリ名'),
        keyword: z.string().optional().describe('メモ・店名・カテゴリ名に含まれる言葉'),
        type: z.enum(['expense', 'income']).optional(),
        min_amount: z.number().int().optional(),
        max_amount: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      let categories: string[] | undefined;
      if (args.category) {
        const cats = await repo.categories(userId);
        const self = cats.find((c) => c.name === args.category);
        categories = [args.category, ...cats.filter((c) => self && c.parentId === self.id).map((c) => c.name)];
      }
      const found = await repo.searchEntries(userId, {
        from: args.from,
        to: args.to,
        type: args.type,
        categories,
        keyword: args.keyword,
        minAmount: args.min_amount,
        maxAmount: args.max_amount,
        limit: args.limit,
      });
      return result({ ...found, truncated: found.count > found.entries.length });
    },
  );

  server.registerTool(
    'get_summary',
    {
      title: '月の収支',
      description:
        'その月の支出・収入・収支と、支出のカテゴリ別（親でまとめ、子の内訳つき。share は支出全体に占める割合%）、月の予算。',
      inputSchema: z.object({ month: MONTH.optional() }),
      annotations: READ_ONLY,
    },
    async ({ month }) => {
      const m = month ?? monthOf(todayJST());
      const [s, cats, budget] = await Promise.all([
        repo.monthSummary(userId, m),
        repo.categories(userId),
        repo.budget(userId),
      ]);
      const groups = groupByParent(s.byCategory, cats).map((g) => ({
        ...g,
        share: s.expense ? Math.round((g.total / s.expense) * 1000) / 10 : 0,
      }));
      return result({
        month: m,
        expense: s.expense,
        income: s.income,
        balance: s.income - s.expense,
        budget: budget || null,
        expenseByCategory: groups,
        incomeByCategory: s.incomeByCategory,
        entryCount: s.entries.length,
      });
    },
  );

  server.registerTool(
    'compare_months',
    {
      title: '2つの月を比べる',
      description:
        '2つの月の支出・収入と、カテゴリ別（親でまとめた）支出の差を、差の大きい順に返す。diff は month_b − month_a。',
      inputSchema: z.object({ month_a: MONTH, month_b: MONTH }),
      annotations: READ_ONLY,
    },
    async ({ month_a, month_b }) => {
      const [a, b, cats] = await Promise.all([
        repo.monthSummary(userId, month_a),
        repo.monthSummary(userId, month_b),
        repo.categories(userId),
      ]);
      return result({
        monthA: { month: month_a, expense: a.expense, income: a.income },
        monthB: { month: month_b, expense: b.expense, income: b.income },
        expenseDiff: b.expense - a.expense,
        byCategory: compareGroups(groupByParent(a.byCategory, cats), groupByParent(b.byCategory, cats)),
      });
    },
  );

  server.registerTool(
    'get_budget_status',
    {
      title: '予算のペース',
      description:
        '月の予算に対する支出のペース。projectedTotal はこのペースで月末まで使ったときの支出、' +
        'safeDailySpend は残りの日（今日を含む）に1日いくらまでなら予算に収まるか。予算がなければ budget は null。',
      inputSchema: z.object({ month: MONTH.optional() }),
      annotations: READ_ONLY,
    },
    async ({ month }) => {
      const today = todayJST();
      const m = month ?? monthOf(today);
      const [s, budget] = await Promise.all([repo.monthSummary(userId, m), repo.budget(userId)]);
      return result(budgetStatus(m, today, s.expense, budget));
    },
  );

  server.registerTool(
    'get_shift_income',
    {
      title: 'シフト収入',
      description:
        'Google カレンダーのシフトから計算した、その月の入金予定・働いた分・シフト一覧と、その年に支給される給与（勤務済み・予定）と目安ライン。' +
        'jobs はバイト先ごとの時給・締め日・給料日などの設定（「目安ラインまであと何時間働けるか」の計算に使う）。',
      inputSchema: z.object({ month: MONTH.optional() }),
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    async ({ month }) => {
      const [y, m] = (month ?? monthOf(todayJST())).split('-').map(Number);
      const [report, jobs] = await Promise.all([
        loadReport(env, repo, userId, y, m, Date.now()),
        repo.shiftJobs(userId),
      ]);
      return result({ ...report, jobs });
    },
  );

  return server;
}
