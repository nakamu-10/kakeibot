import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { groupByParent } from '../src/category';
import { budgetChange, entryChange, fixedCostChange, undoBatch } from '../src/changes';
import { findRecurring, monthlyTotal, sanitizeFixedCost } from '../src/fixed';
import { Repo } from '../src/db';
import { loadReport } from '../src/shift/report';
import { monthOf, shiftMonth, todayJST } from '../src/util';
import type { McpEnv } from './env';
import { budgetStatus, categoryTree, compareGroups, usageInsights } from './stats';

const MONTH = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .describe('YYYY-MM（日本時間）。省略すると今月');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** 結果を JSON で返す（AI が読みやすいように、文章ではなく構造で） */
const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
/** AI に直してもらうための失敗（例外ではなく、ツールの結果として返す） */
const error = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/**
 * 家計簿の MCP サーバー（1リクエストごとに作る）。userId は LINE ログインで確かめた本人。
 * 読み取り（kakeibo:read）と、記録の追加・修正・削除（kakeibo:write）。予算やカテゴリなどの設定は変えない。
 * 金額は円の整数、日付は日本時間の 'YYYY-MM-DD'
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

  // ---------- アプリを良くする ----------
  server.registerTool(
    'get_usage_insights',
    {
      title: '使い方の分析',
      description:
        'アプリの直しどころを考えるための、使い方のまとめ（直近 months か月）。' +
        'bySource は記録の付け方（text=トーク、receipt=レシート、app=家計簿の画面、payday=給料日の自動記録、ai=AI から）、' +
        'other は「その他」になった記録（topMemos はカテゴリのキーワードに足す候補）、edited はあとで直された記録、' +
        'daysWithoutEntries は記録のない日と曜日、recordedLater はあとからまとめて付けた記録。feedback はこの人が送った要望。' +
        '改善案は、アプリの設定で直せること（キーワード・子カテゴリなど）と、アプリ自体の直し（要望として send_feedback で残す）に分けて伝える。',
      inputSchema: z.object({ months: z.number().int().min(1).max(12).default(3) }),
      annotations: READ_ONLY,
    },
    async ({ months }) => {
      const today = todayJST();
      const from = `${shiftMonth(monthOf(today), -(months - 1))}-01`;
      const [rows, feedback] = await Promise.all([repo.entriesForInsights(userId, from), repo.feedback(userId)]);
      return result({ ...usageInsights(rows, from, today), feedback });
    },
  );

  server.registerTool(
    'send_feedback',
    {
      title: 'アプリへの要望を残す',
      description:
        '家計簿アプリへの要望や不便なところを、開発者に届くよう残す（非公開）。' +
        'ユーザーが言ったことを、何に困っていて、どうなるとよいかが分かる1〜3文にまとめて送る。金額や店名などの個人の情報は入れない。',
      inputSchema: z.object({ body: z.string().min(1).max(1000).describe('要望の文') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ body }) => {
      const id = await repo.addFeedback(userId, body.trim());
      return result({ saved: true, id });
    },
  );

  // ---------- 書き込み（スコープ kakeibo:write。許可がなければ index.ts が 403 で求め直す） ----------
  server.registerTool(
    'add_entries',
    {
      title: '記録を追加する',
      description:
        '家計簿に記録を追加する（まとめて30件まで）。category は list_categories の name か children の name をそのまま使う。' +
        '支出か収入かはカテゴリで決まる。1件でもカテゴリが見つからなければ、何も記録せずにエラーを返す。' +
        'レシートや購入履歴の写真から記録するときは、合計ではなく品目ごとに分けるかどうかをユーザーに合わせる。',
      inputSchema: z.object({
        entries: z
          .array(
            z.object({
              date: DATE.optional().describe('YYYY-MM-DD（日本時間）。省略すると今日'),
              category: z.string().describe('カテゴリ名'),
              amount: z.number().int().positive().describe('金額（円）'),
              memo: z.string().max(100).optional().describe('何に使ったか（例: ランチ）'),
              store: z.string().max(50).optional().describe('店名'),
            }),
          )
          .min(1)
          .max(30),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ entries }) => {
      const cats = await repo.categories(userId);
      const unknown = entries.map((e) => e.category).filter((name) => !cats.some((c) => c.name === name));
      if (unknown.length) {
        return error(
          `カテゴリが見つかりません: ${[...new Set(unknown)].join('、')}。list_categories の名前を使ってください。何も記録していません。`,
        );
      }
      const today = todayJST();
      const added = [];
      for (const e of entries) {
        const type = cats.find((c) => c.name === e.category)?.type ?? 'expense';
        const id = await repo.addEntry(userId, {
          type,
          category: e.category,
          amount: e.amount,
          memo: e.memo ?? '',
          store: e.store ?? '',
          date: e.date ?? today,
          source: 'ai',
        });
        added.push(await repo.mustGetEntry(userId, id));
      }
      await repo.recordChanges(
        userId,
        crypto.randomUUID(),
        added.map((e) => entryChange('insert', null, e)),
      );
      return result({ added });
    },
  );

  server.registerTool(
    'update_entry',
    {
      title: '記録を直す',
      description:
        '記録の日付・カテゴリ・金額・メモを直す（渡したものだけ変える）。id は search_entries や add_entries の結果のもの。' +
        'カテゴリを変えると、支出か収入かもそのカテゴリに合わせる。',
      inputSchema: z.object({
        id: z.number().int(),
        date: DATE.optional(),
        category: z.string().optional(),
        amount: z.number().int().positive().optional(),
        memo: z.string().max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, date, category, amount, memo }) => {
      const before = await repo.getEntry(userId, id);
      if (!before) return error(`id ${id} の記録が見つかりません（消されたか、別の人の記録です）。`);
      let type = undefined;
      if (category) {
        const cat = (await repo.categories(userId)).find((c) => c.name === category);
        if (!cat) return error(`カテゴリ「${category}」が見つかりません。list_categories の名前を使ってください。`);
        type = cat.type;
      }
      await repo.updateEntry(userId, id, { date, category, amount, memo, type });
      const after = await repo.mustGetEntry(userId, id);
      await repo.recordChanges(userId, crypto.randomUUID(), [entryChange('update', before, after)]);
      return result({ before, after });
    },
  );

  server.registerTool(
    'delete_entry',
    {
      title: '記録を消す',
      description: '記録を1件消す。元に戻せないので、消す前に、どの記録かをユーザーに確かめる。',
      inputSchema: z.object({ id: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const entry = await repo.getEntry(userId, id);
      if (!entry) return error(`id ${id} の記録が見つかりません（もう消されたか、別の人の記録です）。`);
      await repo.deleteEntry(userId, id);
      await repo.recordChanges(userId, crypto.randomUUID(), [entryChange('delete', entry, null)]);
      return result({ deleted: entry });
    },
  );

  server.registerTool(
    'set_budget',
    {
      title: '月の予算を変える',
      description:
        '月の予算（支出の上限、円）を変える。0 で予算なし。変える前に、いくらにするかをユーザーに確かめる。undo_changes で戻せる。',
      inputSchema: z.object({ amount: z.number().int().min(0).describe('円。0 で予算なし') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ amount }) => {
      const before = await repo.budget(userId);
      await repo.setBudget(userId, amount);
      await repo.recordChanges(userId, crypto.randomUUID(), [budgetChange(before, amount)]);
      return result({ before, after: amount });
    },
  );

  // ---------- 固定費・サブスク ----------
  server.registerTool(
    'list_fixed_costs',
    {
      title: '固定費・サブスクの一覧',
      description:
        '登録した固定費・サブスク（家賃・スマホ・サブスクなど）。monthlyTotal は、やめていないものを毎月かかる額にならした合計（毎年のものは12で割る）。' +
        'autoRecord が true のものは、払う日の朝に家計簿へ支出として自動で記録される。手で記録したものも含め、記録された固定費は家計簿の支出に入っている。' +
        '毎月いくら貯金・投資に回せるかは、収入の平均から支出の平均を引いて考え、固定費をもう一度は引かない。年払いのように月によって出ない分は、monthlyTotal でならして考える。',
      annotations: READ_ONLY,
    },
    async () => {
      const items = await repo.fixedCosts(userId);
      return result({ items, monthlyTotal: monthlyTotal(items) });
    },
  );

  server.registerTool(
    'find_recurring_payments',
    {
      title: '固定費の候補を探す',
      description:
        '直近 months か月の記録から、毎月のように同じくらいの金額で出ている支払い（固定費・サブスクの候補）を探す。登録済みのものは除く。' +
        '見つけたものを登録するかは、ユーザーに確かめてから save_fixed_cost で登録する。',
      inputSchema: z.object({ months: z.number().int().min(2).max(12).default(6) }),
      annotations: READ_ONLY,
    },
    async ({ months }) => {
      const from = `${shiftMonth(monthOf(todayJST()), -(months - 1))}-01`;
      const [entries, registered] = await Promise.all([repo.expensesSince(userId, from), repo.fixedCosts(userId)]);
      return result(findRecurring(entries, registered));
    },
  );

  server.registerTool(
    'save_fixed_cost',
    {
      title: '固定費を登録・変更する',
      description:
        '固定費・サブスクを登録する（id を省く）か、変える（id を渡す。渡したものだけでなく、すべての項目を送る）。' +
        'やめたサブスクは消さずに active を false にすると、あとで見返せる。category は支出のカテゴリ名（list_categories）。undo_changes で戻せる。',
      inputSchema: z.object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(30),
        amount: z.number().int().positive().describe('1回に払う額（円）'),
        category: z.string(),
        cycle: z.enum(['monthly', 'yearly']).default('monthly'),
        day: z.number().int().min(1).max(31).default(1).describe('払う日（31は月末）'),
        month: z.number().int().min(0).max(12).optional().describe('毎年のとき、払う月（1〜12）。毎月なら省くか 0'),
        active: z.boolean().default(true),
        autoRecord: z
          .boolean()
          .default(true)
          .describe('払う日の朝に家計簿へ自動で記録する。true のものは手で記録しないようユーザーに伝える'),
        memo: z.string().max(100).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const cats = await repo.categories(userId);
      if (!cats.some((c) => c.name === args.category && c.type === 'expense')) {
        return error(`支出のカテゴリ「${args.category}」が見つかりません。list_categories の名前を使ってください。`);
      }
      const before = args.id ? await repo.getFixedCost(userId, args.id) : null;
      if (args.id && !before) return error(`id ${args.id} の固定費が見つかりません。`);
      const saved = await repo.saveFixedCost(userId, sanitizeFixedCost({ ...args, id: args.id ?? 0 }));
      await repo.recordChanges(userId, crypto.randomUUID(), [
        fixedCostChange(before ? 'update' : 'insert', before, saved),
      ]);
      return result({ before, after: saved });
    },
  );

  server.registerTool(
    'delete_fixed_cost',
    {
      title: '固定費を消す',
      description:
        '固定費を消す。やめたサブスクは、消さずに save_fixed_cost で active を false にする方がよい。undo_changes で戻せる。',
      inputSchema: z.object({ id: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const before = await repo.getFixedCost(userId, id);
      if (!before) return error(`id ${id} の固定費が見つかりません。`);
      await repo.deleteFixedCost(userId, id);
      await repo.recordChanges(userId, crypto.randomUUID(), [fixedCostChange('delete', before, null)]);
      return result({ deleted: before });
    },
  );

  // ---------- 変更の履歴と取り消し ----------
  server.registerTool(
    'list_changes',
    {
      title: 'AI による変更の履歴',
      description:
        'AI（このサーバー）が家計簿に加えた変更を、1回の依頼ごとに新しい順で返す。batch を undo_changes に渡すと、その回の変更を戻せる。',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      annotations: READ_ONLY,
    },
    async ({ limit }) => result(await repo.changeBatches(userId, limit)),
  );

  server.registerTool(
    'undo_changes',
    {
      title: '変更を取り消す',
      description:
        'AI が加えた変更を、1回の依頼の単位で元に戻す。batch を省くと、まだ取り消していない直前の回を戻す。' +
        'その後にユーザーが直した記録は戻さず skipped で返す。戻す前に、どの変更を戻すかをユーザーに確かめる。',
      inputSchema: z.object({ batch: z.string().optional().describe('list_changes の batch') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ batch }) => {
      const target = batch ?? (await repo.latestUndoableBatch(userId));
      if (!target) return error('取り消せる変更がありません。');
      const changes = await repo.changesOf(userId, target);
      if (!changes.length) return error(`変更 ${target} が見つかりません。list_changes の batch を使ってください。`);
      const outcome = await undoBatch(repo, userId, changes);
      await repo.markUndone(userId, target);
      return result({ batch: target, ...outcome });
    },
  );

  return server;
}
