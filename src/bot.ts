import type { Env, Entry } from './types';
import { Repo } from './db';
import { extractDate, parseEntry } from './parse';
import { readReceipt } from './receipt';
import { getContent, qrCamera, qrMessage, qrPostback, qrUri, reply, showLoading, text, type LineMessage } from './line';
import { monthOf, normalize, shiftMonth, todayJST, yen } from './util';

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId?: string };
  message?: { type: string; id: string; text?: string };
  postback?: { data: string };
}

const HELP = `使い方
・「ランチ 800」のように送ると支出を記録
・「+給料 50000」または「収入 バイト 30000」で収入を記録
・「昨日 スーパー 2480」「11/20 本 1200」で日付指定
・レシートの写真を送るとAIが読み取って記録

コマンド
・今月 / 先月 … 集計を表示
・予算 50000 … 月の予算を設定
・取り消し … 直前の記録を削除
・カテゴリ … カテゴリ一覧
・グラフ … グラフ・設定画面を開く`;

export async function handleEvent(env: Env, ev: LineEvent): Promise<void> {
  const userId = ev.source.userId;
  if (!ev.replyToken || !userId) return;

  if (ev.source.type !== 'user') {
    await reply(env, ev.replyToken, [text('グループでの共有家計簿は次のバージョンで対応予定です。個別トークで使ってください。')]);
    return;
  }

  const repo = new Repo(env.DB);
  await repo.ensureUser(userId);
  const ctx = { env, repo, userId, replyToken: ev.replyToken };

  if (ev.type === 'follow') {
    await reply(env, ev.replyToken, [text('友だち追加ありがとうございます。\n\n' + HELP, defaultQuickReplies(env))]);
    return;
  }

  if (ev.type === 'postback' && ev.postback) return handlePostback(ctx, ev.postback.data);

  if (ev.type === 'message' && ev.message) {
    if (ev.message.type === 'text' && ev.message.text) return handleText(ctx, ev.message.text);
    if (ev.message.type === 'image') return handleImage(ctx, ev.message.id);
    await reply(env, ev.replyToken, [text('テキストかレシートの写真を送ってください。')]);
  }
}

type Ctx = { env: Env; repo: Repo; userId: string; replyToken: string };

// ---------------- テキスト ----------------
async function handleText(ctx: Ctx, raw: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const t = normalize(raw);
  const today = todayJST();

  if (/^(ヘルプ|使い方|help|\?)$/i.test(t)) return reply(env, replyToken, [text(HELP, defaultQuickReplies(env))]);
  if (/^(今月|集計|今月の合計)$/.test(t)) return replySummary(ctx, monthOf(today));
  if (/^先月$/.test(t)) return replySummary(ctx, shiftMonth(monthOf(today), -1));
  if (/^(グラフ|アプリ|設定|家計簿)$/.test(t)) {
    return reply(env, replyToken, [text(`グラフ・履歴・設定はこちら\n${liffUrl(env)}`)]);
  }
  if (/^(取り?消し?す?|取消|undo)$/i.test(t)) {
    const last = await repo.lastEntry(userId);
    if (!last) return reply(env, replyToken, [text('取り消せる記録がありません。')]);
    await repo.deleteEntry(userId, last.id);
    return reply(env, replyToken, [text(`取り消しました\n${describe(last)}`)]);
  }
  if (/^カテゴリ$/.test(t)) {
    const cats = await repo.categories(userId);
    const ex = cats.filter((c) => c.type === 'expense').map((c) => c.name).join(' / ');
    const inc = cats.filter((c) => c.type === 'income').map((c) => c.name).join(' / ');
    return reply(env, replyToken, [text(`支出: ${ex}\n収入: ${inc}\n\n追加・並び替えは「グラフ」→設定から`)]);
  }
  const b = t.match(/^予算\s*(\d+)?\s*円?$/);
  if (b) {
    if (b[1]) {
      await repo.setBudget(userId, parseInt(b[1], 10));
      return reply(env, replyToken, [text(`月の予算を ${yen(parseInt(b[1], 10))} に設定しました。`)]);
    }
    const budget = await repo.budget(userId);
    return reply(env, replyToken, [text(budget ? `今の月予算は ${yen(budget)} です。\n変更は「予算 50000」のように送ってください。` : '予算は未設定です。「予算 50000」のように送ってください。')]);
  }

  // 記録
  const { date, rest } = extractDate(t, today);
  const cats = await repo.categories(userId);
  const parsed = parseEntry(rest, cats);
  if (!parsed) {
    return reply(env, replyToken, [text('うまく読み取れませんでした。「ランチ 800」のように送ってください。\n「ヘルプ」で使い方を表示します。')]);
  }
  const id = await repo.addEntry(userId, { ...parsed, date, source: 'text' });
  const entry = (await repo.getEntry(userId, id))!;
  return replyRecorded(ctx, entry);
}

// ---------------- レシート画像 ----------------
async function handleImage(ctx: Ctx, messageId: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  await showLoading(env, userId, 30);
  const today = todayJST();
  try {
    const { data, mime } = await getContent(env, messageId);
    const cats = (await repo.categories(userId)).filter((c) => c.type === 'expense').map((c) => c.name);
    const r = await readReceipt(env, data, mime, cats, today);
    if (!r.isReceipt) {
      return reply(env, replyToken, [text('レシートを読み取れませんでした。明るい場所で、レシート全体が写るように撮ってみてください。')]);
    }
    // 未来日付・極端に古い日付は今日に寄せる
    const date = r.date && r.date <= today && r.date >= shiftMonth(monthOf(today), -12) + '-01' ? r.date : today;
    const memo = r.items.slice(0, 3).map((i) => i.name).join('、') + (r.items.length > 3 ? ' など' : '');
    const id = await repo.addEntry(userId, {
      type: 'expense',
      category: r.category,
      amount: r.total,
      memo,
      store: r.store,
      date,
      source: 'receipt',
    });
    const entry = (await repo.getEntry(userId, id))!;
    return replyRecorded(ctx, entry, 'レシートを読み取りました ✓');
  } catch (e) {
    console.error(e);
    return reply(env, replyToken, [text('読み取り中にエラーが起きました。少し待ってからもう一度送ってください。')]);
  }
}

// ---------------- ポストバック ----------------
async function handlePostback(ctx: Ctx, data: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const p = new URLSearchParams(data);
  const id = Number(p.get('id'));
  const action = p.get('action');

  if (action === 'summary') return replySummary(ctx, monthOf(todayJST()));

  const entry = id ? await repo.getEntry(userId, id) : null;
  if (!entry) return reply(env, replyToken, [text('その記録は見つかりませんでした（削除済みかもしれません）。')]);

  if (action === 'undo') {
    await repo.deleteEntry(userId, id);
    return reply(env, replyToken, [text(`取り消しました\n${describe(entry)}`)]);
  }
  if (action === 'cat') {
    const cats = (await repo.categories(userId)).filter((c) => c.type === entry.type && c.name !== entry.category);
    return reply(env, replyToken, [
      text(
        'どのカテゴリに変更しますか？',
        cats.slice(0, 13).map((c) => qrPostback(c.name, `action=setcat&id=${id}&c=${encodeURIComponent(c.name)}`, c.name)),
      ),
    ]);
  }
  if (action === 'setcat') {
    const c = p.get('c');
    if (!c) return;
    await repo.updateEntry(userId, id, { category: c });
    const updated = (await repo.getEntry(userId, id))!;
    return replyRecorded(ctx, updated, 'カテゴリを変更しました ✓');
  }
}

// ---------------- 返信の組み立て ----------------
async function replyRecorded(ctx: Ctx, e: Entry, title = '記録しました ✓'): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const month = monthOf(e.date);
  const s = await repo.monthSummary(userId, month);
  const budget = await repo.budget(userId);
  const label = month === monthOf(todayJST()) ? '今月' : `${Number(month.slice(5))}月`;

  const lines = [title, describe(e)];
  if (e.type === 'expense') {
    lines.push('', `${label}の${e.category} ${yen(s.byCategory[e.category] ?? 0)}`, `${label}の支出 ${yen(s.expense)}`);
    if (budget) lines.push(`予算残り ${yen(budget - s.expense)}`);
  } else {
    lines.push('', `${label}の収入 ${yen(s.income)}`);
  }

  await reply(env, replyToken, [
    text(lines.join('\n'), [
      qrPostback('取り消す', `action=undo&id=${e.id}`, '取り消す'),
      qrPostback('カテゴリ変更', `action=cat&id=${e.id}`, 'カテゴリ変更'),
      qrMessage('今月'),
      qrCamera(),
      qrUri('グラフ', liffUrl(env)),
    ]),
  ]);
}

async function replySummary(ctx: Ctx, month: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const s = await repo.monthSummary(userId, month);
  const budget = await repo.budget(userId);
  const [y, m] = month.split('-');
  const lines = [`${y}年${Number(m)}月の家計簿`, '', `支出 ${yen(s.expense)}`, `収入 ${yen(s.income)}`, `収支 ${yen(s.income - s.expense)}`];
  if (budget) {
    lines.push(`予算残り ${yen(budget - s.expense)}（${Math.round((s.expense / budget) * 100)}% 使用）`);
  }
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    lines.push('', '― カテゴリ別 ―');
    for (const [c, v] of cats) lines.push(`${c} ${yen(v)}`);
  }
  await reply(env, replyToken, [text(lines.join('\n'), [qrMessage('先月'), qrUri('グラフで見る', liffUrl(env))])]);
}

function describe(e: Entry): string {
  const sign = e.type === 'income' ? '+' : '';
  const what = [e.store, e.memo].filter(Boolean).join(' ');
  const datePart = e.date !== todayJST() ? `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))} ` : '';
  return `${datePart}[${e.category}] ${what ? what + ' ' : ''}${sign}${yen(e.amount)}`;
}

function liffUrl(env: Env): string {
  return `https://liff.line.me/${env.LIFF_ID}`;
}

function defaultQuickReplies(env: Env): LineMessage[] {
  return [qrCamera(), qrMessage('今月'), qrMessage('予算'), qrMessage('カテゴリ'), qrUri('グラフ', liffUrl(env))];
}
