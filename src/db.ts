import type { Category, Entry, EntryType } from './types';
import { DEFAULT_CATEGORIES } from './parse';
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
      .prepare('SELECT id, name, type, sort, keywords FROM categories WHERE user_id = ? ORDER BY type, sort, id')
      .bind(userId)
      .all<Category>();
    return r.results;
  }

  async addCategory(userId: string, name: string, type: EntryType, keywords = ''): Promise<void> {
    const max = await this.db
      .prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM categories WHERE user_id = ?')
      .bind(userId)
      .first<{ m: number }>();
    await this.db
      .prepare('INSERT INTO categories (user_id, name, type, sort, keywords) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, name, type, (max?.m ?? -1) + 1, keywords)
      .run();
  }

  async updateCategory(userId: string, id: number, fields: { name?: string; keywords?: string }): Promise<void> {
    const cur = await this.db
      .prepare('SELECT name FROM categories WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<{ name: string }>();
    if (!cur) return;
    const stmts = [
      this.db
        .prepare('UPDATE categories SET name = COALESCE(?, name), keywords = COALESCE(?, keywords) WHERE id = ? AND user_id = ?')
        .bind(fields.name ?? null, fields.keywords ?? null, id, userId),
    ];
    // 名前を変えたら過去の記録も付け替える
    if (fields.name && fields.name !== cur.name) {
      stmts.push(
        this.db.prepare('UPDATE entries SET category = ? WHERE user_id = ? AND category = ?').bind(fields.name, userId, cur.name),
      );
    }
    await this.db.batch(stmts);
  }

  async deleteCategory(userId: string, id: number): Promise<void> {
    await this.db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId).run();
  }

  async reorderCategories(userId: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.db.batch(
      ids.map((id, i) => this.db.prepare('UPDATE categories SET sort = ? WHERE id = ? AND user_id = ?').bind(i, id, userId)),
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

  // ---------- 記録 ----------
  async addEntry(
    userId: string,
    e: { type: EntryType; category: string; amount: number; memo?: string; store?: string; date: string; source?: string },
  ): Promise<number> {
    const r = await this.db
      .prepare(
        'INSERT INTO entries (user_id, type, category, amount, memo, store, date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      )
      .bind(userId, e.type, e.category, e.amount, e.memo ?? '', e.store ?? '', e.date, e.source ?? 'text')
      .first<{ id: number }>();
    return r!.id;
  }

  async getEntry(userId: string, id: number): Promise<Entry | null> {
    return this.db
      .prepare('SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<Entry>();
  }

  async lastEntry(userId: string): Promise<Entry | null> {
    return this.db
      .prepare('SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE user_id = ? ORDER BY id DESC LIMIT 1')
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
           memo = COALESCE(?, memo), date = COALESCE(?, date)
         WHERE id = ? AND user_id = ?`,
      )
      .bind(f.type ?? null, f.category ?? null, f.amount ?? null, f.memo ?? null, f.date ?? null, id, userId)
      .run();
  }

  async deleteEntry(userId: string, id: number): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return (r.meta.changes ?? 0) > 0;
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

  async allEntries(userId: string): Promise<Entry[]> {
    const r = await this.db
      .prepare('SELECT id, type, category, amount, memo, store, date, source FROM entries WHERE user_id = ? ORDER BY date, id')
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
}
