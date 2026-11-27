import type { Category, Env, Entry } from './types';
import { Repo } from './db';
import { extractDate, parseAmountOnly, parseEntry, parseLines } from './parse';
import { ReceiptUnavailableError, readReceipt } from './receipt';
import {
  getContent,
  liffUrl,
  qrCamera,
  qrMessage,
  qrPostback,
  qrUri,
  reply,
  showLoading,
  text,
  type LineMessage,
} from './line';
import { loadReport } from './shift/report';
import { incomingText } from './shift/text';
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
・改行して何行か送ると、まとめて記録
・レシートの写真を送るとAIが読み取って記録

コマンド
・今月 / 先月 … 集計を表示
・予算 50000 … 月の予算を設定
・取り消し … 直前の記録を削除
・カテゴリ … カテゴリ一覧
・グラフ … グラフ・設定画面を開く
・収入 … シフト収入の今月の入金予定
・通知オン / 通知オフ … 記録していない日の夜9時に知らせる`;

export async function handleEvent(env: Env, ev: LineEvent): Promise<void> {
  const userId = ev.source.userId;
  if (!ev.replyToken || !userId) return;

  if (ev.source.type !== 'user') {
    await reply(env, ev.replyToken, [
      text('グループでの共有家計簿は次のバージョンで対応予定です。個別トークで使ってください。'),
    ]);
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

/** 「金額を直す」を押してから、金額を待つ時間 */
const FIX_WAIT_MS = 10 * 60_000;

// ---------------- テキスト ----------------
async function handleText(ctx: Ctx, raw: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const t = normalize(raw);
  const today = todayJST();

  // 「金額を直す」を押したあとに数字だけ送られたら、その記録の金額を直す（ほかの入力なら待つのをやめる）
  const fixId = await repo.takeAmountFix(userId, new Date());
  const fixAmount = parseAmountOnly(t);
  if (fixId && fixAmount) {
    await repo.updateEntry(userId, fixId, { amount: fixAmount });
    const fixed = await repo.getEntry(userId, fixId);
    if (fixed) return replyRecorded(ctx, fixed, '金額を直しました ✓');
  }

  if (/^(ヘルプ|使い方|help|\?)$/i.test(t)) return reply(env, replyToken, [text(HELP, defaultQuickReplies(env))]);
  if (/^(今月|集計|今月の合計)$/.test(t)) return replySummary(ctx, monthOf(today));
  if (/^先月$/.test(t)) return replySummary(ctx, shiftMonth(monthOf(today), -1));
  // 「収入 バイト 30000」は収入の記録なので、「収入」だけのときに限る
  if (/^(収入|入金予定)$/.test(t)) return replyIncoming(ctx, today);
  const remind = /^通知\s*(オン|on|オフ|off)?$/i.exec(t);
  if (remind) {
    if (remind[1]) await repo.setRemind(userId, /^(オン|on)$/i.test(remind[1]));
    const on = await repo.remind(userId);
    return reply(env, replyToken, [
      text(
        on
          ? '記録忘れ通知はオンです。記録していない日の夜9時にお知らせします。止めるときは「通知オフ」と送ってください。'
          : '記録忘れ通知はオフです。始めるときは「通知オン」と送ってください。',
      ),
    ]);
  }
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
    const ex = cats
      .filter((c) => c.type === 'expense')
      .map((c) => c.name)
      .join(' / ');
    const inc = cats
      .filter((c) => c.type === 'income')
      .map((c) => c.name)
      .join(' / ');
    return reply(env, replyToken, [text(`支出: ${ex}\n収入: ${inc}\n\n追加・並び替えは「グラフ」→設定から`)]);
  }
  const b = t.match(/^予算\s*(\d+)?\s*円?$/);
  if (b) {
    if (b[1]) {
      await repo.setBudget(userId, parseInt(b[1], 10));
      return reply(env, replyToken, [text(`月の予算を ${yen(parseInt(b[1], 10))} に設定しました。`)]);
    }
    const budget = await repo.budget(userId);
    return reply(env, replyToken, [
      text(
        budget
          ? `今の月予算は ${yen(budget)} です。\n変更は「予算 50000」のように送ってください。`
          : '予算は未設定です。「予算 50000」のように送ってください。',
      ),
    ]);
  }

  // 記録
  const cats = await repo.categories(userId);
  if (t.includes('\n')) return recordLines(ctx, t, cats, today);
  const { date, rest } = extractDate(t, today);
  const parsed = parseEntry(rest, cats);
  if (!parsed) {
    return reply(env, replyToken, [
      text('うまく読み取れませんでした。「ランチ 800」のように送ってください。\n「ヘルプ」で使い方を表示します。'),
    ]);
  }
  const id = await repo.addEntry(userId, { ...parsed, date, source: 'text' });
  const entry = await repo.mustGetEntry(userId, id);
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
      await reply(env, replyToken, [
        text('レシートを読み取れませんでした。明るい場所で、レシート全体が写るように撮ってみてください。'),
      ]);
      return;
    }
    // 未来日付・極端に古い日付は今日に寄せる
    const date = r.date && r.date <= today && r.date >= shiftMonth(monthOf(today), -12) + '-01' ? r.date : today;
    const memo =
      r.items
        .slice(0, 3)
        .map((i) => i.name)
        .join('、') + (r.items.length > 3 ? ' など' : '');
    const id = await repo.addEntry(userId, {
      type: 'expense',
      category: r.category,
      amount: r.total,
      memo,
      store: r.store,
      date,
      source: 'receipt',
    });
    const entry = await repo.mustGetEntry(userId, id);
    await replyRecorded(ctx, entry, 'レシートを読み取りました ✓');
  } catch (e) {
    console.error(e);
    if (e instanceof ReceiptUnavailableError) {
      return reply(env, replyToken, [
        text(
          'レシート読み取りが混み合っているか、利用回数の上限に達しています。時間をおいて送るか、「ランチ 800」のように文字で記録してください。',
        ),
      ]);
    }
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
  if (action === 'undoall') {
    const ids = (p.get('ids') ?? '')
      .split(',')
      .map(Number)
      .filter((n) => n > 0);
    let deleted = 0;
    for (const i of ids) if (await repo.deleteEntry(userId, i)) deleted++;
    return reply(env, replyToken, [
      text(deleted ? `${deleted}件取り消しました。` : '取り消せる記録がありませんでした（削除済みかもしれません）。'),
    ]);
  }

  const entry = id ? await repo.getEntry(userId, id) : null;
  if (!entry) return reply(env, replyToken, [text('その記録は見つかりませんでした（削除済みかもしれません）。')]);

  if (action === 'fixamt') {
    await repo.setAmountFix(userId, id, new Date(Date.now() + FIX_WAIT_MS));
    return reply(env, replyToken, [
      text(`${describe(entry)}
正しい金額を数字だけで送ってください（例：6500）。`),
    ]);
  }
  if (action === 'undo') {
    await repo.deleteEntry(userId, id);
    return reply(env, replyToken, [text(`取り消しました\n${describe(entry)}`)]);
  }
  if (action === 'cat') {
    const cats = (await repo.categories(userId)).filter((c) => c.type === entry.type && c.name !== entry.category);
    return reply(env, replyToken, [
      text(
        'どのカテゴリに変更しますか？',
        cats
          .slice(0, 13)
          .map((c) => qrPostback(c.name, `action=setcat&id=${id}&c=${encodeURIComponent(c.name)}`, c.name)),
      ),
    ]);
  }
  if (action === 'setcat') {
    const c = p.get('c');
    if (!c) return;
    await repo.updateEntry(userId, id, { category: c });
    const updated = await repo.mustGetEntry(userId, id);
    return replyRecorded(ctx, updated, 'カテゴリを変更しました ✓');
  }
}

/** 改行で区切った複数の記録をまとめて記録する */
async function recordLines(ctx: Ctx, input: string, cats: Category[], today: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const { entries, failed } = parseLines(input, cats, today);
  if (!entries.length) {
    return reply(env, replyToken, [
      text('うまく読み取れませんでした。1行に1件ずつ「ランチ 800」のように送ってください。'),
    ]);
  }
  const ids: number[] = [];
  for (const e of entries) ids.push(await repo.addEntry(userId, { ...e, source: 'text' }));
  if (ids.length === 1 && !failed.length) return replyRecorded(ctx, await repo.mustGetEntry(userId, ids[0]));

  const month = monthOf(today);
  const s = await repo.monthSummary(userId, month);
  const budget = await repo.budget(userId);
  const recorded = s.entries.filter((e) => ids.includes(e.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  // 先月以前の日付の記録は今月の集計に入らないので、別に読む
  for (const id of ids) {
    if (!recorded.some((e) => e.id === id)) recorded.push(await repo.mustGetEntry(userId, id));
  }
  const lines = [`${ids.length}件記録しました ✓`, ...recorded.map(describe)];
  if (failed.length) lines.push('', '読み取れなかった行', ...failed.map((f) => `・${f}`));
  lines.push('', `今月の支出 ${yen(s.expense)}`);
  if (budget) lines.push(`予算残り ${yen(budget - s.expense)}`);
  await reply(env, replyToken, [
    text(lines.join('\n'), [
      qrPostback('まとめて取り消す', `action=undoall&ids=${ids.join(',')}`, 'まとめて取り消す'),
      qrMessage('今月'),
      qrUri('グラフ', liffUrl(env)),
    ]),
  ]);
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
  const lines = [
    `${y}年${Number(m)}月の家計簿`,
    '',
    `支出 ${yen(s.expense)}`,
    `収入 ${yen(s.income)}`,
    `収支 ${yen(s.income - s.expense)}`,
  ];
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

async function replyIncoming(ctx: Ctx, today: string): Promise<void> {
  const { env, repo, userId, replyToken } = ctx;
  const [y, m] = today.split('-').map(Number);
  const report = await loadReport(env, repo, userId, y, m, Date.now());
  await reply(env, replyToken, [text(incomingText(report), [qrUri('シフト収入', liffUrl(env, '/shift'))])]);
}

function describe(e: Entry): string {
  const sign = e.type === 'income' ? '+' : '';
  const what = [e.store, e.memo].filter(Boolean).join(' ');
  const datePart = e.date !== todayJST() ? `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))} ` : '';
  return `${datePart}[${e.category}] ${what ? what + ' ' : ''}${sign}${yen(e.amount)}`;
}

function defaultQuickReplies(env: Env): LineMessage[] {
  return [qrCamera(), qrMessage('今月'), qrMessage('予算'), qrMessage('カテゴリ'), qrUri('グラフ', liffUrl(env))];
}
