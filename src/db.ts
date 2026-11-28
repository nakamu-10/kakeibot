import type { Change, ChangeOp, ChangeTarget, StoredChange } from './changes';
import type { Category, Entry, EntryType } from './types';
import { sanitizeFixedCost, type FixedCost } from './fixed';
import { sanitizeGoal, type Goal } from './goals';
import { sanitizeAccount, type Account, type Balance } from './assets';
import { DEFAULT_CATEGORIES } from './parse';
import { sanitizeJob, type Allowance, type Job } from './shift/calc';
import { daysInMonth, shiftMonth } from './util';

export class Repo {
  constructor(private db: D1Database) {}

  /** 初回アクセス時にユーザーと初期カテゴリを作る */
  async ensureUser(userId: string): Promise<void> {
    const exists = await this.db.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first();
    if (exists) return;
    const stmts = [
      this.db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').bind(userId),
      ...DEFAULT_CATEGORIES.map((c, i) =>
        this.db
          .prepare('INSERT OR IGNORE INTO categories (user_id, name, type, sort, keywords) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, c.name, c.type, i, c.keywords),
      ),
    ];
    await this.db.batch(stmts);
  }

  // ---------- カテゴリ ----------
  async categories(userId: string): Promise<Category[]> {
    const r = await this.db
      .prepare(
        'SELECT id, name, type, sort, keywords, parent_id AS parentId FROM categories WHERE user_id = ? ORDER BY type, sort, id',
      )
      .bind(userId)
      .all<Category>();
    return r.results;
  }

  async addCategory(userId: string, name: string, type: EntryType, keywords = '', parentId = 0): Promise<void> {
    const max = await this.db
      .prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM categories WHERE user_id = ?')
      .bind(userId)
      .first<{ m: number }>();
    await this.db
      .prepare('INSERT INTO categories (user_id, name, type, sort, keywords, parent_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, name, type, (max?.m ?? -1) + 1, keywords, parentId)
      .run();
  }

  async updateCategory(
    userId: string,
    id: number,
    fields: { name?: string; keywords?: string; parentId?: number },
  ): Promise<void> {
    const cur = await this.db
      .prepare('SELECT name FROM categories WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<{ name: string }>();
    if (!cur) return;
    const stmts = [
      this.db
        .prepare(
          `UPDATE categories SET name = COALESCE(?, name), keywords = COALESCE(?, keywords),
             parent_id = COALESCE(?, parent_id) WHERE id = ? AND user_id = ?`,
        )
        .bind(fields.name ?? null, fields.keywords ?? null, fields.parentId ?? null, id, userId),
    ];
    // 名前を変えたら過去の記録も付け替える
    if (fields.name && fields.name !== cur.name) {
      stmts.push(
        this.db
          .prepare('UPDATE entries SET category = ? WHERE user_id = ? AND category = ?')
          .bind(fields.name, userId, cur.name),
      );
    }
    await this.db.batch(stmts);
  }

  /** 消したカテゴリの子は、一番上の段に上げる（記録はそのまま残る） */
  async deleteCategory(userId: string, id: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('UPDATE categories SET parent_id = 0 WHERE parent_id = ? AND user_id = ?').bind(id, userId),
      this.db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId),
    ]);
  }

  async reorderCategories(userId: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.db.batch(
      ids.map((id, i) =>
        this.db.prepare('UPDATE categories SET sort = ? WHERE id = ? AND user_id = ?').bind(i, id, userId),
      ),
    );
  }

  // ---------- 予算 ----------
  async budget(userId: string): Promise<number> {
    const r = await this.db.prepare('SELECT budget FROM users WHERE id = ?').bind(userId).first<{ budget: number }>();
    return r?.budget ?? 0;
  }

  async setBudget(userId: string, amount: number): Promise<void> {
    await this.db.prepare('UPDATE users SET budget = ? WHERE id = ?').bind(amount, userId).run();
  }

  // ---------- 記録忘れ通知 ----------
  async remind(userId: string): Promise<boolean> {
    const r = await this.db.prepare('SELECT remind FROM users WHERE id = ?').bind(userId).first<{ remind: number }>();
    return r?.remind === 1;
  }

  async setRemind(userId: string, on: boolean): Promise<void> {
    await this.db
      .prepare('UPDATE users SET remind = ? WHERE id = ?')
      .bind(on ? 1 : 0, userId)
      .run();
  }

  /** 通知をオンにしていて、sinceUtc 以降に自分で1件も記録していない人（給料日の自動記録は数えない） */
  async usersToRemind(sinceUtc: string): Promise<string[]> {
    const r = await this.db
      .prepare(
        `SELECT id FROM users u WHERE remind = 1 AND NOT EXISTS (
           SELECT 1 FROM entries e WHERE e.user_id = u.id AND e.source NOT IN ('payday', 'fixed') AND e.created_at >= ?
         )`,
      )
      .bind(sinceUtc)
      .all<{ id: string }>();
    return r.results.map((x) => x.id);
  }

  // ---------- 記録 ----------
  async addEntry(
    userId: string,
    e: {
      type: EntryType;
      category: string;
      amount: number;
      memo?: string;
      store?: string;
      date: string;
      source?: string;
    },
  ): Promise<number> {
    const r = await this.db
      .prepare(
        'INSERT INTO entries (user_id, type, category, amount, memo, store, date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      )
      .bind(userId, e.type, e.category, e.amount, e.memo ?? '', e.store ?? '', e.date, e.source ?? 'text')
      .first<{ id: number }>();
    if (!r) throw new Error('insert failed');
    return r.id;
  }

  async getEntry(userId: string, id: number): Promise<Entry | null> {
    return this.db
      .prepare('SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<Entry>();
  }

  /** 直前に作った・更新した記録を読む（無ければ例外） */
  async mustGetEntry(userId: string, id: number): Promise<Entry> {
    const e = await this.getEntry(userId, id);
    if (!e) throw new Error(`entry ${id} not found`);
    return e;
  }

  async lastEntry(userId: string): Promise<Entry | null> {
    return this.db
      .prepare(
        'SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      )
      .bind(userId)
      .first<Entry>();
  }

  async updateEntry(
    userId: string,
    id: number,
    f: Partial<Pick<Entry, 'type' | 'category' | 'amount' | 'memo' | 'date'>>,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE entries SET
           type = COALESCE(?, type), category = COALESCE(?, category), amount = COALESCE(?, amount),
           memo = COALESCE(?, memo), date = COALESCE(?, date), edit_count = edit_count + 1
         WHERE id = ? AND user_id = ?`,
      )
      .bind(f.type ?? null, f.category ?? null, f.amount ?? null, f.memo ?? null, f.date ?? null, id, userId)
      .run();
  }

  /** 消した記録を、同じ id で戻す（取り消し用） */
  async restoreEntry(userId: string, e: Entry): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO entries (id, user_id, type, category, amount, memo, store, date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(e.id, userId, e.type, e.category, e.amount, e.memo, e.store, e.date, e.source)
      .run();
  }

  async deleteEntry(userId: string, id: number): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return r.meta.changes > 0;
  }

  async entriesOfMonth(userId: string, month: string): Promise<Entry[]> {
    const r = await this.db
      .prepare(
        `SELECT id, type, category, amount, memo, store, date, source FROM entries
         WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC`,
      )
      .bind(userId, `${month}-01`, `${month}-31`)
      .all<Entry>();
    return r.results;
  }

  /**
   * 条件で記録を探す（新しい順に limit 件）。件数と合計は、limit に関係なく条件に合うものすべてで数える
   */
  async searchEntries(
    userId: string,
    f: EntrySearch,
  ): Promise<{ entries: Entry[]; count: number; expense: number; income: number }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const add = (sql: string, ...values: (string | number)[]) => {
      where.push(sql);
      params.push(...values);
    };
    add('user_id = ?', userId);
    if (f.from) add('date >= ?', f.from);
    if (f.to) add('date <= ?', f.to);
    if (f.type) add('type = ?', f.type);
    if (f.categories?.length) add(`category IN (${f.categories.map(() => '?').join(', ')})`, ...f.categories);
    if (f.keyword) {
      // LIKE の % と _ は、言葉どおりに探すためエスケープする
      const like = `%${f.keyword.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      add("(memo LIKE ? ESCAPE '\\' OR store LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')", like, like, like);
    }
    if (f.minAmount != null) add('amount >= ?', f.minAmount);
    if (f.maxAmount != null) add('amount <= ?', f.maxAmount);
    const cond = where.join(' AND ');
    const [list, agg] = await this.db.batch([
      this.db
        .prepare(
          `SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE ${cond}
           ORDER BY date DESC, id DESC LIMIT ?`,
        )
        .bind(...params, f.limit),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
             COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income
           FROM entries WHERE ${cond}`,
        )
        .bind(...params),
    ]);
    const totals = agg.results[0] as { count: number; expense: number; income: number };
    return { entries: list.results as Entry[], ...totals };
  }

  /** 使い方の分析のため、期間の記録を必要な列だけ読む（from 以降、日本時間の 'YYYY-MM-DD'） */
  async entriesForInsights(
    userId: string,
    from: string,
  ): Promise<
    { date: string; category: string; memo: string; source: string; edit_count: number; created_at: string }[]
  > {
    const r = await this.db
      .prepare(
        'SELECT date, category, memo, source, edit_count, created_at FROM entries WHERE user_id = ? AND date >= ?',
      )
      .bind(userId, from)
      .all<{ date: string; category: string; memo: string; source: string; edit_count: number; created_at: string }>();
    return r.results;
  }

  // ---------- 固定費 ----------
  async fixedCosts(userId: string): Promise<FixedCost[]> {
    const r = await this.db
      .prepare(
        'SELECT id, name, amount, category, cycle, day, month, active, auto_record, memo FROM fixed_costs WHERE user_id = ? ORDER BY active DESC, amount DESC, id',
      )
      .bind(userId)
      .all();
    return r.results.map((row) =>
      sanitizeFixedCost({ ...row, active: row.active === 1, autoRecord: row.auto_record === 1 }),
    );
  }

  async getFixedCost(userId: string, id: number): Promise<FixedCost | null> {
    return (await this.fixedCosts(userId)).find((f) => f.id === id) ?? null;
  }

  /** id が 0 なら足し、そうでなければ上書きする。保存したものを返す */
  async saveFixedCost(userId: string, f: FixedCost): Promise<FixedCost> {
    const fields = [
      f.name,
      f.amount,
      f.category,
      f.cycle,
      f.day,
      f.month,
      f.active ? 1 : 0,
      f.autoRecord ? 1 : 0,
      f.memo,
    ];
    if (f.id > 0) {
      await this.db
        .prepare(
          'UPDATE fixed_costs SET name = ?, amount = ?, category = ?, cycle = ?, day = ?, month = ?, active = ?, auto_record = ?, memo = ? WHERE id = ? AND user_id = ?',
        )
        .bind(...fields, f.id, userId)
        .run();
      return f;
    }
    const r = await this.db
      .prepare(
        'INSERT INTO fixed_costs (name, amount, category, cycle, day, month, active, auto_record, memo, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      )
      .bind(...fields, userId)
      .first<{ id: number }>();
    if (!r) throw new Error('insert failed');
    return { ...f, id: r.id };
  }

  async deleteFixedCost(userId: string, id: number): Promise<void> {
    await this.db.prepare('DELETE FROM fixed_costs WHERE id = ? AND user_id = ?').bind(id, userId).run();
  }

  /** 消した固定費を、同じ id で戻す（取り消し用） */
  async restoreFixedCost(userId: string, f: FixedCost): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO fixed_costs (id, user_id, name, amount, category, cycle, day, month, active, auto_record, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        f.id,
        userId,
        f.name,
        f.amount,
        f.category,
        f.cycle,
        f.day,
        f.month,
        f.active ? 1 : 0,
        f.autoRecord ? 1 : 0,
        f.memo,
      )
      .run();
  }

  /** 自動で記録する固定費（全員分）。払う日かどうかは呼ぶ側で見る */
  async autoFixedCosts(): Promise<(FixedCost & { userId: string })[]> {
    const r = await this.db
      .prepare(
        'SELECT id, user_id, name, amount, category, cycle, day, month, active, auto_record, memo FROM fixed_costs WHERE active = 1 AND auto_record = 1',
      )
      .all();
    return r.results.map((row) => ({
      ...sanitizeFixedCost({ ...row, active: true, autoRecord: true }),
      userId: String(row.user_id),
    }));
  }

  /** 固定費を、その日の分として家計簿に記録する。同じ日にもう記録していれば何もせず null */
  async recordFixedCost(userId: string, f: FixedCost, date: string): Promise<number | null> {
    const claim = await this.db
      .prepare('UPDATE fixed_costs SET last_recorded = ? WHERE id = ? AND user_id = ? AND last_recorded != ?')
      .bind(date, f.id, userId, date)
      .run();
    if (claim.meta.changes === 0) return null;
    await this.ensureCategory(userId, f.category, 'expense');
    return this.addEntry(userId, {
      type: 'expense',
      category: f.category,
      amount: f.amount,
      memo: f.name,
      date,
      source: 'fixed',
    });
  }

  /** 固定費の候補を探すため、期間の支出を読む */
  async expensesSince(
    userId: string,
    from: string,
  ): Promise<{ date: string; category: string; amount: number; memo: string; store: string }[]> {
    const r = await this.db
      .prepare(
        "SELECT date, category, amount, memo, store FROM entries WHERE user_id = ? AND type = 'expense' AND date >= ?",
      )
      .bind(userId, from)
      .all<{ date: string; category: string; amount: number; memo: string; store: string }>();
    return r.results;
  }

  // ---------- 目標 ----------
  async goals(userId: string): Promise<Goal[]> {
    const r = await this.db
      .prepare(
        "SELECT id, name, target, saved, account_ids, deadline, memo FROM goals WHERE user_id = ? ORDER BY deadline = '', deadline, id",
      )
      .bind(userId)
      .all();
    return r.results.map((row) => sanitizeGoal(row));
  }

  async getGoal(userId: string, id: number): Promise<Goal | null> {
    return (await this.goals(userId)).find((g) => g.id === id) ?? null;
  }

  /** id が 0 なら足し、そうでなければ上書きする。保存したものを返す */
  async saveGoal(userId: string, g: Goal): Promise<Goal> {
    const fields = [g.name, g.target, g.saved, JSON.stringify(g.accountIds), g.deadline, g.memo];
    if (g.id > 0) {
      await this.db
        .prepare(
          'UPDATE goals SET name = ?, target = ?, saved = ?, account_ids = ?, deadline = ?, memo = ? WHERE id = ? AND user_id = ?',
        )
        .bind(...fields, g.id, userId)
        .run();
      return g;
    }
    const r = await this.db
      .prepare(
        'INSERT INTO goals (name, target, saved, account_ids, deadline, memo, user_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      )
      .bind(...fields, userId)
      .first<{ id: number }>();
    if (!r) throw new Error('insert failed');
    return { ...g, id: r.id };
  }

  async deleteGoal(userId: string, id: number): Promise<void> {
    await this.db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').bind(id, userId).run();
  }

  /** 消した目標を、同じ id で戻す（取り消し用） */
  async restoreGoal(userId: string, g: Goal): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO goals (id, user_id, name, target, saved, account_ids, deadline, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(g.id, userId, g.name, g.target, g.saved, JSON.stringify(g.accountIds), g.deadline, g.memo)
      .run();
  }

  // ---------- 資産 ----------
  async accounts(userId: string): Promise<Account[]> {
    const r = await this.db
      .prepare('SELECT id, name, kind, active, memo FROM accounts WHERE user_id = ? ORDER BY active DESC, id')
      .bind(userId)
      .all();
    return r.results.map((row) => sanitizeAccount({ ...row, active: row.active === 1 }));
  }

  async getAccount(userId: string, id: number): Promise<Account | null> {
    return (await this.accounts(userId)).find((a) => a.id === id) ?? null;
  }

  /** id が 0 なら足し、そうでなければ上書きする。保存したものを返す */
  async saveAccount(userId: string, a: Account): Promise<Account> {
    const fields = [a.name, a.kind, a.active ? 1 : 0, a.memo];
    if (a.id > 0) {
      await this.db
        .prepare('UPDATE accounts SET name = ?, kind = ?, active = ?, memo = ? WHERE id = ? AND user_id = ?')
        .bind(...fields, a.id, userId)
        .run();
      return a;
    }
    const r = await this.db
      .prepare('INSERT INTO accounts (name, kind, active, memo, user_id) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(...fields, userId)
      .first<{ id: number }>();
    if (!r) throw new Error('insert failed');
    return { ...a, id: r.id };
  }

  /** 口座と、その口座の残高をすべて消す */
  async deleteAccount(userId: string, id: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM balances WHERE account_id = ? AND user_id = ?').bind(id, userId),
      this.db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId),
    ]);
  }

  /** 消した口座を、同じ id で戻す（取り消し用） */
  async restoreAccount(userId: string, a: Account): Promise<void> {
    await this.db
      .prepare('INSERT INTO accounts (id, user_id, name, kind, active, memo) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(a.id, userId, a.name, a.kind, a.active ? 1 : 0, a.memo)
      .run();
  }

  async balances(userId: string): Promise<Balance[]> {
    const r = await this.db
      .prepare(
        'SELECT account_id AS accountId, month, balance, contribution FROM balances WHERE user_id = ? ORDER BY month, account_id',
      )
      .bind(userId)
      .all<Balance>();
    return r.results;
  }

  async getBalance(userId: string, accountId: number, month: string): Promise<Balance | null> {
    return (
      (await this.db
        .prepare(
          'SELECT account_id AS accountId, month, balance, contribution FROM balances WHERE user_id = ? AND account_id = ? AND month = ?',
        )
        .bind(userId, accountId, month)
        .first<Balance>()) ?? null
    );
  }

  async setBalance(userId: string, b: Balance): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO balances (account_id, user_id, month, balance, contribution) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account_id, month) DO UPDATE SET balance = excluded.balance, contribution = excluded.contribution, updated_at = datetime('now')`,
      )
      .bind(b.accountId, userId, b.month, b.balance, b.contribution)
      .run();
  }

  async deleteBalance(userId: string, accountId: number, month: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM balances WHERE user_id = ? AND account_id = ? AND month = ?')
      .bind(userId, accountId, month)
      .run();
  }

  // ---------- 変更の履歴（取り消し用） ----------
  async recordChanges(userId: string, batch: string, changes: Change[]): Promise<void> {
    if (!changes.length) return;
    await this.db.batch(
      changes.map((c) =>
        this.db
          .prepare(
            'INSERT INTO changes (user_id, batch, target, target_id, op, before, after, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            userId,
            batch,
            c.target,
            c.targetId,
            c.op,
            JSON.stringify(c.before),
            JSON.stringify(c.after),
            c.summary,
          ),
      ),
    );
  }

  /** 最近の変更を、1回の依頼ごとにまとめて新しい順に（createdAt は日本時間の 'YYYY-MM-DD HH:MM:SS'） */
  async changeBatches(
    userId: string,
    limit = 10,
  ): Promise<{ batch: string; createdAt: string; summaries: string[]; undone: boolean }[]> {
    const batches = await this.db
      .prepare(
        `SELECT batch, datetime(MIN(created_at), '+9 hours') AS createdAt, MAX(undone) AS undone FROM changes WHERE user_id = ?
         GROUP BY batch ORDER BY MAX(id) DESC LIMIT ?`,
      )
      .bind(userId, limit)
      .all<{ batch: string; createdAt: string; undone: number }>();
    return Promise.all(
      batches.results.map(async (b) => ({
        batch: b.batch,
        createdAt: b.createdAt,
        undone: b.undone === 1,
        summaries: (await this.changesOf(userId, b.batch)).map((c) => c.summary),
      })),
    );
  }

  async changesOf(userId: string, batch: string): Promise<StoredChange[]> {
    const r = await this.db
      .prepare(
        'SELECT id, target, target_id, op, before, after, summary FROM changes WHERE user_id = ? AND batch = ? ORDER BY id',
      )
      .bind(userId, batch)
      .all<{
        id: number;
        target: ChangeTarget;
        target_id: number;
        op: ChangeOp;
        before: string;
        after: string;
        summary: string;
      }>();
    return r.results.map((c) => ({
      id: c.id,
      target: c.target,
      targetId: c.target_id,
      op: c.op,
      before: JSON.parse(c.before) as unknown,
      after: JSON.parse(c.after) as unknown,
      summary: c.summary,
    }));
  }

  /** まだ取り消していない、いちばん新しい依頼 */
  async latestUndoableBatch(userId: string): Promise<string | null> {
    const r = await this.db
      .prepare('SELECT batch FROM changes WHERE user_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1')
      .bind(userId)
      .first<{ batch: string }>();
    return r?.batch ?? null;
  }

  async markUndone(userId: string, batch: string): Promise<void> {
    await this.db.prepare('UPDATE changes SET undone = 1 WHERE user_id = ? AND batch = ?').bind(userId, batch).run();
  }

  // ---------- 要望 ----------
  async addFeedback(userId: string, body: string): Promise<number> {
    const r = await this.db
      .prepare('INSERT INTO feedback (user_id, body) VALUES (?, ?) RETURNING id')
      .bind(userId, body)
      .first<{ id: number }>();
    if (!r) throw new Error('insert failed');
    return r.id;
  }

  /** その人が送った要望（新しい順） */
  async feedback(
    userId: string,
    limit = 20,
  ): Promise<{ id: number; body: string; status: string; created_at: string }[]> {
    const r = await this.db
      .prepare('SELECT id, body, status, created_at FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .bind(userId, limit)
      .all<{ id: number; body: string; status: string; created_at: string }>();
    return r.results;
  }

  async allEntries(userId: string): Promise<Entry[]> {
    const r = await this.db
      .prepare(
        'SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE user_id = ? ORDER BY date, id',
      )
      .bind(userId)
      .all<Entry>();
    return r.results;
  }

  /** 月の集計（トーク返信・アプリ共通） */
  async monthSummary(userId: string, month: string) {
    const entries = await this.entriesOfMonth(userId, month);
    let expense = 0;
    let income = 0;
    const byCategory: Record<string, number> = {};
    const incomeByCategory: Record<string, number> = {};
    const daily = new Array(daysInMonth(month)).fill(0) as number[];
    for (const e of entries) {
      if (e.type === 'expense') {
        expense += e.amount;
        byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
        const d = parseInt(e.date.slice(8, 10), 10) - 1;
        if (d >= 0 && d < daily.length) daily[d] += e.amount;
      } else {
        income += e.amount;
        incomeByCategory[e.category] = (incomeByCategory[e.category] ?? 0) + e.amount;
      }
    }
    return { month, expense, income, byCategory, incomeByCategory, daily, entries };
  }

  /** 直近 n か月の推移 */
  async trend(userId: string, endMonth: string, n = 6) {
    const start = shiftMonth(endMonth, -(n - 1));
    const r = await this.db
      .prepare(
        `SELECT substr(date, 1, 7) AS m, type, SUM(amount) AS total FROM entries
         WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY m, type`,
      )
      .bind(userId, `${start}-01`, `${endMonth}-31`)
      .all<{ m: string; type: EntryType; total: number }>();
    const months = Array.from({ length: n }, (_, i) => shiftMonth(start, i));
    return months.map((m) => ({
      month: m,
      expense: r.results.find((x) => x.m === m && x.type === 'expense')?.total ?? 0,
      income: r.results.find((x) => x.m === m && x.type === 'income')?.total ?? 0,
    }));
  }
  // ---------- シフト収入 ----------
  async shiftJobs(userId: string): Promise<Job[]> {
    const r = await this.db
      .prepare('SELECT * FROM shift_jobs WHERE user_id = ? ORDER BY sort, id')
      .bind(userId)
      .all<ShiftJobRow>();
    return r.results.map(rowToJob);
  }

  /** バイト先か仕送りを設定している人（給料日・仕送りの日の処理用） */
  async usersWithShiftIncome(): Promise<string[]> {
    const r = await this.db
      .prepare('SELECT user_id FROM shift_jobs UNION SELECT user_id FROM allowances')
      .all<{ user_id: string }>();
    return r.results.map((x) => x.user_id);
  }

  async allowances(userId: string): Promise<Allowance[]> {
    const r = await this.db
      .prepare('SELECT id, name, amount, day FROM allowances WHERE user_id = ? ORDER BY sort, id')
      .bind(userId)
      .all<Allowance>();
    return r.results;
  }

  /** 年間の目安ライン、シフトのカレンダーの非公開URL（暗号化したまま。空 = 未登録）、家計簿へ自動で記録するか */
  async shiftSettings(userId: string): Promise<{ wall: number; icalUrlEnc: string; autoRecord: boolean }> {
    const r = await this.db
      .prepare('SELECT income_wall, ical_url_enc, auto_record FROM shift_settings WHERE user_id = ?')
      .bind(userId)
      .first<{ income_wall: number; ical_url_enc: string; auto_record: number }>();
    return { wall: r?.income_wall ?? 0, icalUrlEnc: r?.ical_url_enc ?? '', autoRecord: (r?.auto_record ?? 1) === 1 };
  }

  /**
   * シフト収入の設定をまとめて保存する。
   * jobs にない既存のバイト先は消す。icalUrlEnc が null なら今の URL を残す
   */
  async saveShiftSettings(
    userId: string,
    s: { jobs: Job[]; allowances: Allowance[]; wall: number; icalUrlEnc: string | null; autoRecord: boolean },
  ): Promise<void> {
    const keep = s.jobs.map((j) => j.id).filter((id) => id > 0);
    const stmts = [
      this.db
        .prepare(`DELETE FROM shift_jobs WHERE user_id = ? AND id NOT IN (SELECT value FROM json_each(?))`)
        .bind(userId, JSON.stringify(keep)),
      ...s.jobs.map((j, sort) => {
        const fields = [
          j.name,
          j.keywords,
          j.weekdayRate,
          j.weekendRate,
          j.holidayAsWeekend ? 1 : 0,
          j.nightEnabled ? 1 : 0,
          j.nightPremium,
          JSON.stringify(j.breaks),
          j.roundUnit,
          j.transport,
          j.closingDay,
          j.payMonthOffset,
          j.payDay,
          sort,
        ];
        if (j.id > 0) {
          return this.db
            .prepare(
              `UPDATE shift_jobs SET name = ?, keywords = ?, weekday_rate = ?, weekend_rate = ?, holiday_as_weekend = ?,
                 night_enabled = ?, night_premium = ?, breaks = ?, round_unit = ?, transport = ?, closing_day = ?,
                 pay_month_offset = ?, pay_day = ?, sort = ?
               WHERE id = ? AND user_id = ?`,
            )
            .bind(...fields, j.id, userId);
        }
        return this.db
          .prepare(
            `INSERT INTO shift_jobs (name, keywords, weekday_rate, weekend_rate, holiday_as_weekend, night_enabled,
               night_premium, breaks, round_unit, transport, closing_day, pay_month_offset, pay_day, sort, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(...fields, userId);
      }),
      this.db.prepare('DELETE FROM allowances WHERE user_id = ?').bind(userId),
      ...s.allowances.map((a, sort) =>
        this.db
          .prepare('INSERT INTO allowances (user_id, name, amount, day, sort) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, a.name, a.amount, a.day, sort),
      ),
      this.db
        .prepare(
          `INSERT INTO shift_settings (user_id, income_wall, auto_record, ical_url_enc) VALUES (?, ?, ?, COALESCE(?, ''))
           ON CONFLICT (user_id) DO UPDATE SET
             income_wall = excluded.income_wall,
             auto_record = excluded.auto_record,
             ical_url_enc = COALESCE(?, shift_settings.ical_url_enc)`,
        )
        .bind(userId, s.wall, s.autoRecord ? 1 : 0, s.icalUrlEnc, s.icalUrlEnc),
    ];
    await this.db.batch(stmts);
  }

  /**
   * 給料日・仕送りの日の見込み額を、収入として家計簿に記録する。
   * 同じ日の同じ給与・仕送りは一度だけ（手で消したあとも記録し直さない）。記録しなかったら null
   */
  async recordPayday(
    userId: string,
    r: { kind: 'job' | 'allowance'; refId: number; payDate: string; amount: number; category: string; memo: string },
  ): Promise<number | null> {
    const claim = await this.db
      .prepare(
        'INSERT OR IGNORE INTO payday_entries (user_id, kind, ref_id, pay_date, expected) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(userId, r.kind, r.refId, r.payDate, r.amount)
      .run();
    if (claim.meta.changes === 0) return null;
    await this.ensureCategory(userId, r.category, 'income');
    const id = await this.addEntry(userId, {
      type: 'income',
      category: r.category,
      amount: r.amount,
      memo: r.memo,
      date: r.payDate,
      source: 'payday',
    });
    await this.db
      .prepare('UPDATE payday_entries SET entry_id = ? WHERE user_id = ? AND kind = ? AND ref_id = ? AND pay_date = ?')
      .bind(id, userId, r.kind, r.refId, r.payDate)
      .run();
    return id;
  }

  /** カテゴリがなければ末尾に足す（「仕送り」など、あとから増えた初期カテゴリ用） */
  async ensureCategory(userId: string, name: string, type: EntryType): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO categories (user_id, name, type, sort, keywords)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories WHERE user_id = ?), '')`,
      )
      .bind(userId, name, type, userId)
      .run();
  }

  // ---------- 「金額を直す」の待ち ----------
  /** 次に数字だけ送られたら、この記録の金額を直す */
  async setAmountFix(userId: string, entryId: number, until: Date): Promise<void> {
    await this.db
      .prepare('UPDATE users SET fix_entry_id = ?, fix_until = ? WHERE id = ?')
      .bind(entryId, until.toISOString(), userId)
      .run();
  }

  /** 待っている記録の id を取り出して消す。期限切れ・なしなら 0 */
  async takeAmountFix(userId: string, now: Date): Promise<number> {
    // 読んでから消す（SQLite の RETURNING は消したあとの値を返すため、batch で順に流す）
    const [read] = await this.db.batch<{ id: number; until: string }>([
      this.db.prepare('SELECT fix_entry_id AS id, fix_until AS until FROM users WHERE id = ?').bind(userId),
      this.db
        .prepare("UPDATE users SET fix_entry_id = 0, fix_until = '' WHERE id = ? AND fix_entry_id != 0")
        .bind(userId),
    ]);
    const r = read.results[0] as { id: number; until: string } | undefined;
    return r && r.id && r.until > now.toISOString() ? r.id : 0;
  }
}

interface ShiftJobRow {
  id: number;
  name: string;
  keywords: string;
  weekday_rate: number;
  weekend_rate: number;
  holiday_as_weekend: number;
  night_enabled: number;
  night_premium: number;
  breaks: string;
  round_unit: number;
  transport: number;
  closing_day: number;
  pay_month_offset: number;
  pay_day: number;
}

function rowToJob(r: ShiftJobRow): Job {
  let breaks: unknown = [];
  try {
    breaks = JSON.parse(r.breaks);
  } catch {
    // 壊れていたら休憩なしとして読む
  }
  return sanitizeJob({
    id: r.id,
    name: r.name,
    keywords: r.keywords,
    weekdayRate: r.weekday_rate,
    weekendRate: r.weekend_rate,
    holidayAsWeekend: r.holiday_as_weekend === 1,
    nightEnabled: r.night_enabled === 1,
    nightPremium: r.night_premium,
    breaks,
    roundUnit: r.round_unit,
    transport: r.transport,
    closingDay: r.closing_day,
    payMonthOffset: r.pay_month_offset,
    payDay: r.pay_day,
  });
}

export interface EntrySearch {
  from?: string;
  to?: string;
  type?: EntryType;
  /** この中のどれかのカテゴリ（親を探すときは子の名前も入れる） */
  categories?: string[];
  /** メモ・店名・カテゴリ名に含まれる言葉 */
  keyword?: string;
  minAmount?: number;
  maxAmount?: number;
  limit: number;
}
