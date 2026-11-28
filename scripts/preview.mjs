// LINE を通さずに LIFF 画面を手元で開く（架空のデータ）。画面の見た目と使い勝手を確かめるため
// 使い方: node scripts/preview.mjs → http://localhost:8790/app と http://localhost:8790/app/shift
// LIFF の SDK はダミーに差し替え、/api/* は架空のデータを返す。書き込みはメモリの中だけ
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { groupByParent, orderCategories } from '../src/category.ts';
import { buildReport, jstMidnight, sanitizeAllowance, sanitizeJob } from '../src/shift/calc.ts';

const PORT = Number(process.env.PORT ?? 8790);
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

// スクリーンショット用：?tab=list でそのタブ、?click=fab でその id のボタンを押した状態、?scroll=id でその場所まで動かす
const LIFF_STUB = `<script>
window.liff = { init: async () => {}, isLoggedIn: () => true, getIDToken: () => 'preview', login() {} };
addEventListener('load', () => setTimeout(() => {
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) document.querySelector('nav [data-tab="' + tab + '"]')?.click();
  // 読み込みが終わってから押す
  const click = new URLSearchParams(location.search).get('click');
  const press = () =>
    document.getElementById('status')?.style.display === 'none'
      ? document.getElementById(click)?.click()
      : setTimeout(press, 100);
  if (click) press();
  // ?scroll=cat-list でその id の場所まで動かす
  const scroll = new URLSearchParams(location.search).get('scroll');
  if (scroll) setTimeout(() => document.getElementById(scroll)?.scrollIntoView({ block: 'center' }), 800);
}, 300));
</script>`;
const page = (file) =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    .replace(/<script src="https:\/\/static\.line-scdn\.net\/liff[^"]*"><\/script>/, LIFF_STUB)
    .replace('__LIFF_ID__', 'preview');

// ---------- 家計簿 ----------
let nextId = 100;
const categories = [
  ['食費', 'expense', 0, 'ランチ,コンビニ,スーパー'],
  ['日用品', 'expense', 0, 'ドラッグストア,ダイソー'],
  ['交通費', 'expense', 0, '電車,バス'],
  ['交際費', 'expense', 0, '飲み会'],
  ['趣味', 'expense', 0, '本,ゲーム'],
  ['衣服', 'expense', 0, 'ユニクロ'],
  ['その他', 'expense', 0, ''],
  ['給与', 'income', 0, '給料,バイト'],
  ['仕送り', 'income', 0, '仕送り'],
  ['その他収入', 'income', 0, ''],
].map(([name, type, parentId, keywords], i) => ({ id: i + 1, name, type, sort: i, keywords, parentId }));
categories.push(
  { id: 11, name: '雑貨', type: 'expense', sort: 0, keywords: '', parentId: 2 },
  { id: 12, name: '洗剤・消耗品', type: 'expense', sort: 1, keywords: '洗剤', parentId: 2 },
);

const day = (d) => `${thisMonth}-${String(d).padStart(2, '0')}`;
const lastDay = Number(today.slice(8, 10));
let entries = [
  [1, 'expense', '食費', 850, 'ランチ', ''],
  [1, 'expense', '交通費', 220, '電車', ''],
  [2, 'expense', '食費', 2480, '', 'スーパー'],
  [3, 'expense', '雑貨', 550, 'ハンガー', ''],
  [5, 'expense', '趣味', 1200, '本', ''],
  [6, 'expense', '食費', 630, 'コンビニ', ''],
  [8, 'expense', '交際費', 4000, '飲み会', ''],
  [10, 'expense', '衣服', 3990, '', 'ユニクロ'],
  [12, 'expense', '洗剤・消耗品', 398, '洗剤', ''],
  [14, 'expense', '食費', 1580, '', 'スーパー'],
  [15, 'income', '給与', 42000, '珈琲館 10/1〜10/31分', ''],
  [16, 'expense', '食費', 920, 'ランチ', ''],
  [18, 'expense', '日用品', 300, 'ティッシュ', ''],
  [20, 'expense', 'その他', 1500, '', ''],
  [22, 'expense', '食費', 760, 'コンビニ', ''],
  [25, 'income', '仕送り', 50000, '仕送り', ''],
]
  .filter(([d]) => d <= lastDay)
  .map(([d, type, category, amount, memo, store], i) => ({
    id: i + 1,
    type,
    category,
    amount,
    memo,
    store,
    date: day(d),
    source: store ? 'receipt' : 'text',
  }));
let budget = 40000;
let remind = false;

function summary(month) {
  const list = entries
    .filter((e) => e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const byCategory = {};
  const daily = new Array(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate()).fill(0);
  let expense = 0;
  let income = 0;
  for (const e of list) {
    if (e.type === 'expense') {
      expense += e.amount;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
      daily[Number(e.date.slice(8)) - 1] += e.amount;
    } else income += e.amount;
  }
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 6 + i, 1)).toISOString().slice(0, 7);
    return d === month ? { month: d, expense, income } : { month: d, expense: 38000 + i * 1500, income: 90000 };
  });
  return {
    month,
    expense,
    income,
    byCategory,
    groups: groupByParent(byCategory, categories),
    daily,
    entries: list,
    trend,
    budget,
    categories: orderCategories(categories),
    remind,
    fixedCosts: {
      items: fixedCosts,
      monthlyTotal: fixedCosts
        .filter((f) => f.active)
        .reduce((t, f) => t + (f.cycle === 'yearly' ? Math.round(f.amount / 12) : f.amount), 0),
    },
    goals: {
      monthlySurplus: 30000,
      basis: [],
      goals: goals.map(previewPlan),
    },
    changes: [
      {
        batch: 'b2',
        createdAt: `${today} 10:15:00`,
        undone: false,
        summaries: ['追加：食費 ¥800（ランチ）', '追加：交通費 ¥220（電車）'],
      },
      { batch: 'b1', createdAt: `${today} 09:00:00`, undone: true, summaries: ['予算：¥40,000 → ¥45,000'] },
    ],
    today,
  };
}

// ---------- シフト収入 ----------
const jobs = [
  sanitizeJob({
    id: 1,
    name: '珈琲館',
    keywords: '珈琲館, コーヒー',
    weekdayRate: 1200,
    weekendRate: 1300,
    holidayAsWeekend: true,
    nightEnabled: true,
    breaks: [{ overHours: 6, minutes: 45 }],
    transport: 300,
    closingDay: 31,
    payMonthOffset: 1,
    payDay: 25,
  }),
  sanitizeJob({ id: 2, name: '塾', weekdayRate: 1500, roundUnit: 15, closingDay: 15, payMonthOffset: 0, payDay: 31 }),
];
const allowances = [sanitizeAllowance({ id: 1, name: '仕送り', amount: 50000, day: 25 })];
function shiftReport(year, month) {
  const shifts = [];
  for (let m = 1; m <= 12; m++) {
    for (const d of [3, 7, 10, 14, 17, 21, 24, 28]) {
      const job = d % 7 === 0 ? 2 : 1;
      const start = jstMidnight(year, m, d) + (job === 2 ? 17 : 10) * 3600_000;
      shifts.push({ jobId: job, start, end: start + (job === 2 ? 3 : 7) * 3600_000, breakOverride: null });
    }
  }
  const r = buildReport({ jobs, allowances, wall: 1230000 }, shifts, new Set(), year, month, Date.now());
  return { ...r, errors: [], unmatchedTitles: ['歯医者'], hasJobs: true, hasCalendar: true, today };
}

const fixed = (f) => ({ cycle: 'monthly', month: 0, day: 1, active: true, autoRecord: true, memo: '', ...f });
let fixedCosts = [
  fixed({ id: 1, name: '家賃', amount: 60000, category: '住居', day: 27 }),
  fixed({ id: 2, name: 'スマホ', amount: 2980, category: '通信費', day: 31, autoRecord: false }),
  fixed({ id: 3, name: 'Amazonプライム', amount: 5900, category: '趣味', cycle: 'yearly', month: 3, day: 15 }),
  fixed({ id: 4, name: 'ジム', amount: 7000, category: '美容', active: false }),
];

// src/goals.ts の goalPlan の代わり（node から拡張子なしの import を読めないため。架空のデータを見せるだけ）
const previewPlan = (g) => {
  const remaining = Math.max(0, g.target - g.saved);
  const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  const monthsLeft = g.deadline ? Math.max(1, idx(g.deadline) - idx(thisMonth) + 1) : null;
  const perMonth = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
  const n = idx(thisMonth) + Math.ceil(remaining / 30000) - 1;
  const reachMonth = `${Math.floor((n - 1) / 12)}-${String(((n - 1) % 12) + 1).padStart(2, '0')}`;
  return {
    ...g,
    remaining,
    progress: g.saved / g.target,
    monthsLeft,
    perMonth,
    reachMonth,
    onTrack: perMonth === null ? null : 30000 >= perMonth,
  };
};
let goals = [
  { id: 1, name: '旅行', target: 300000, saved: 60000, accountIds: [], deadline: '2027-08', memo: '' },
  { id: 2, name: '引っ越し', target: 400000, saved: 50000, accountIds: [], deadline: '2027-03', memo: '' },
  { id: 3, name: '生活防衛資金', target: 500000, saved: 0, accountIds: [], deadline: '', memo: '' },
];

// ---------- サーバー ----------
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  let body = '';
  for await (const chunk of req) body += chunk;
  const b = body ? JSON.parse(body) : {};

  if (p === '/' || p === '/app')
    return (res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), res.end(page('app.html')));
  if (p === '/app/ui.css')
    return (
      res.writeHead(200, { 'content-type': 'text/css' }),
      res.end(readFileSync(new URL('../src/ui.css', import.meta.url)))
    );
  if (p === '/app/shift')
    return (res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), res.end(page('shift.html')));

  if (p === '/api/summary') return json(res, summary(url.searchParams.get('month') || thisMonth));
  if (p === '/api/budget') return ((budget = Number(b.amount) || 0), json(res, { ok: true, budget }));
  if (p === '/api/remind') return ((remind = b.on === true), json(res, { ok: true, remind }));
  if (p === '/api/entries' && req.method === 'POST') {
    entries.push({
      id: nextId++,
      type: b.type,
      category: b.category,
      amount: Number(b.amount),
      memo: b.memo ?? '',
      store: '',
      date: b.date,
      source: 'app',
    });
    return json(res, { ok: true });
  }
  const m = /^\/api\/entries\/(\d+)$/.exec(p);
  if (m && req.method === 'DELETE')
    return ((entries = entries.filter((e) => e.id !== Number(m[1]))), json(res, { ok: true }));
  if (m && req.method === 'PATCH') {
    const e = entries.find((x) => x.id === Number(m[1]));
    if (e) Object.assign(e, Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)));
    return json(res, { ok: true });
  }
  if (p === '/api/fixed/candidates')
    return json(res, [{ name: 'Netflix', category: '趣味', amount: 1490, months: 3, lastDate: `${thisMonth}-05` }]);
  if (p === '/api/fixed') {
    const f = fixed({ ...b, id: b.id || Date.now() });
    fixedCosts = [...fixedCosts.filter((x) => x.id !== f.id), f];
    return json(res, f);
  }
  if (p.startsWith('/api/fixed/')) {
    fixedCosts = fixedCosts.filter((x) => x.id !== Number(p.split('/').pop()));
    return json(res, { ok: true });
  }
  if (p === '/api/goals') {
    const g = { memo: '', ...b, id: b.id || Date.now() };
    goals = [...goals.filter((x) => x.id !== g.id), g];
    return json(res, g);
  }
  if (p.startsWith('/api/goals/')) {
    goals = goals.filter((x) => x.id !== Number(p.split('/').pop()));
    return json(res, { ok: true });
  }
  if (p === '/api/changes/undo') return json(res, { ok: true, undone: ['追加：食費 ¥800（ランチ）'], skipped: [] });
  if (p.startsWith('/api/categories')) return json(res, { ok: true });
  if (p === '/api/export.csv') return (res.writeHead(200, { 'content-type': 'text/csv' }), res.end('preview\n'));

  if (p === '/api/shift/settings')
    return json(res, { jobs, allowances, wall: 1230000, hasIcal: true, autoRecord: true });
  if (p === '/api/shift/report') {
    const q = url.searchParams.get('month') || thisMonth;
    return json(res, shiftReport(+q.slice(0, 4), +q.slice(5)));
  }
  json(res, { error: 'not found' }, 404);
}).listen(PORT, () => console.log(`preview: http://localhost:${PORT}/app  http://localhost:${PORT}/app/shift`));
