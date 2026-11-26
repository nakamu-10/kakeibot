/**
 * シフトから給料を計算する（GAS版 Calc.gs の移植。外のAPIは使わない純粋な計算だけ）
 * 時刻はすべて日本時間（UTC+9固定）で扱う。シフトの開始・終了は UNIX ミリ秒
 */

const JST_OFFSET = 9 * 3600_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3600_000;

interface BreakRule {
  /** 勤務時間がこの時間を「超えたら」 */
  overHours: number;
  /** 無給休憩の分数 */
  minutes: number;
}

export interface Job {
  id: number;
  name: string;
  weekdayRate: number;
  /** 0なら平日と同じ */
  weekendRate: number;
  holidayAsWeekend: boolean;
  nightEnabled: boolean;
  /** 深夜（22時〜翌5時）の割増率（%） */
  nightPremium: number;
  breaks: BreakRule[];
  /** 実働時間をこの分単位で切り捨てる */
  roundUnit: number;
  /** 1出勤日あたりの交通費 */
  transport: number;
  /** 締め日（31は末日） */
  closingDay: number;
  /** 給料日が締めの当月(0)・翌月(1)・翌々月(2) */
  payMonthOffset: number;
  /** 給料日（短い月は月末に丸める） */
  payDay: number;
}

export interface Allowance {
  id: number;
  name: string;
  amount: number;
  /** 毎月何日（短い月は月末に丸める） */
  day: number;
}

export interface ShiftSettings {
  jobs: Job[];
  allowances: Allowance[];
  /** 年間の目安ライン（0なら表示しない） */
  wall: number;
}

/** カレンダーから読んだシフト1回分 */
export interface RawShift {
  jobId: number;
  start: number;
  end: number;
  /** 説明欄の「休憩60」。なければ null */
  breakOverride: number | null;
}

/** 'YYYY-MM-DD' をキーにした祝日の集合 */
export type HolidaySet = ReadonlySet<string>;

interface JstParts {
  y: number;
  m: number;
  d: number;
  dow: number;
  h: number;
  mi: number;
}

interface YearMonth {
  y: number;
  m: number;
}

function jstParts(ms: number): JstParts {
  const d = new Date(ms + JST_OFFSET);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    dow: d.getUTCDay(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdKey = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

/** 日本時間のその日の0時（UNIX ミリ秒） */
export function jstMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) - JST_OFFSET;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addMonths(y: number, m: number, k: number): YearMonth {
  const t = y * 12 + (m - 1) + k;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

const clampDay = (y: number, m: number, day: number) => Math.min(day, daysInMonth(y, m));

/** 数値にできなければ def（空文字・null・undefined も def） */
function num(v: unknown, def: number): number {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** バイト先1件の型と範囲をそろえる（設定画面からの入力用） */
export function sanitizeJob(input: unknown): Job {
  const j = obj(input);
  return {
    id: num(j.id, 0),
    name: (typeof j.name === 'string' ? j.name.trim() : '') || 'バイト先',
    weekdayRate: Math.max(0, num(j.weekdayRate, 0)),
    weekendRate: Math.max(0, num(j.weekendRate, 0)),
    holidayAsWeekend: !!j.holidayAsWeekend,
    nightEnabled: !!j.nightEnabled,
    nightPremium: Math.max(0, num(j.nightPremium, 25)),
    breaks: list(j.breaks)
      .map((b) => {
        const r = obj(b);
        return { overHours: Math.max(0, num(r.overHours, 0)), minutes: Math.max(0, num(r.minutes, 0)) };
      })
      .filter((b) => b.minutes > 0),
    roundUnit: Math.max(1, num(j.roundUnit, 1)),
    transport: Math.max(0, num(j.transport, 0)),
    closingDay: clamp(num(j.closingDay, 31), 1, 31),
    payMonthOffset: clamp(num(j.payMonthOffset, 1), 0, 2),
    payDay: clamp(num(j.payDay, 25), 1, 31),
  };
}

/** 毎月決まった収入1件の型と範囲をそろえる */
export function sanitizeAllowance(input: unknown): Allowance {
  const a = obj(input);
  return {
    id: num(a.id, 0),
    name: (typeof a.name === 'string' ? a.name.trim() : '') || '仕送り',
    amount: Math.max(0, num(a.amount, 0)),
    day: clamp(num(a.day, 1), 1, 31),
  };
}

/** 予定の説明欄に「休憩60」「休憩:30」とあれば、その分数で上書き */
export function parseBreakOverride(desc: string | null | undefined): number | null {
  const m = /休憩\s*[:：]?\s*(\d+)/.exec(desc ?? '');
  return m ? Number(m[1]) : null;
}

const overlapMin = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / 60_000;

/** 22時〜翌5時に入っている分数 */
export function nightMinutes(startMs: number, endMs: number): number {
  const p = jstParts(startMs);
  let total = 0;
  for (let t = jstMidnight(p.y, p.m, p.d) - DAY_MS; t < endMs; t += DAY_MS) {
    total += overlapMin(startMs, endMs, t + 22 * HOUR_MS, t + DAY_MS + 5 * HOUR_MS);
  }
  return total;
}

function breakMinutes(job: Job, durMin: number, override: number | null): number {
  if (override !== null) return override;
  // 一番大きい該当ルールを使う
  const rules = [...job.breaks].sort((a, b) => b.overHours - a.overHours);
  return rules.find((r) => durMin > r.overHours * 60)?.minutes ?? 0;
}

/** シフト1回分の計算 */
export function calcShift(job: Job, shift: RawShift, holidays: HolidaySet) {
  const parts = jstParts(shift.start);
  const date = ymdKey(parts.y, parts.m, parts.d);
  const durMin = Math.max(0, (shift.end - shift.start) / 60_000);
  const breakMin = breakMinutes(job, durMin, shift.breakOverride);
  const workMin = Math.floor(Math.max(0, durMin - breakMin) / job.roundUnit) * job.roundUnit;
  // 休憩は深夜帯以外の時間からとる前提
  const nightMin = job.nightEnabled ? Math.min(nightMinutes(shift.start, shift.end), workMin) : 0;
  const isHoliday = holidays.has(date);
  // 土日かどうかはシフトの開始日で決める
  const isWeekend = parts.dow === 0 || parts.dow === 6 || (job.holidayAsWeekend && isHoliday);
  const rate = isWeekend && job.weekendRate > 0 ? job.weekendRate : job.weekdayRate;
  // 1回ごとに1円未満を切り捨てる
  const pay = Math.floor((rate * workMin) / 60 + (rate * (job.nightPremium / 100) * nightMin) / 60);
  return {
    jobId: job.id,
    jobName: job.name,
    start: shift.start,
    end: shift.end,
    parts,
    date,
    durMin,
    breakMin,
    workMin,
    nightMin,
    isWeekend,
    isHoliday,
    rate,
    pay,
  };
}

/** その日のシフトがどの締め期間に入り、いつ支払われるか */
export function payInfo(job: Job, p: { y: number; m: number; d: number }) {
  const cd = clampDay(p.y, p.m, job.closingDay);
  const end = p.d > cd ? addMonths(p.y, p.m, 1) : { y: p.y, m: p.m };
  const endDay = clampDay(end.y, end.m, job.closingDay);
  const prev = addMonths(end.y, end.m, -1);
  const prevClose = clampDay(prev.y, prev.m, job.closingDay);
  let s = { y: prev.y, m: prev.m, d: prevClose + 1 };
  if (s.d > daysInMonth(prev.y, prev.m)) {
    const n = addMonths(prev.y, prev.m, 1);
    s = { y: n.y, m: n.m, d: 1 };
  }
  const pm = addMonths(end.y, end.m, job.payMonthOffset);
  const pd = clampDay(pm.y, pm.m, job.payDay);
  return {
    periodStart: ymdKey(s.y, s.m, s.d),
    periodEnd: ymdKey(end.y, end.m, endDay),
    payDate: ymdKey(pm.y, pm.m, pd),
    payY: pm.y,
    payM: pm.m,
  };
}

export interface SalaryIncoming {
  type: 'salary';
  name: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  count: number;
  workMin: number;
  gross: number;
  transport: number;
  total: number;
}

interface AllowanceIncoming {
  type: 'allowance';
  name: string;
  payDate: string;
  total: number;
}

type Incoming = SalaryIncoming | AllowanceIncoming;

export interface WorkSummary {
  name: string;
  count: number;
  workMin: number;
  pay: number;
  transport: number;
}

/** 画面に出す集計をまとめて作る */
export function buildReport(
  settings: ShiftSettings,
  rawShifts: RawShift[],
  holidays: HolidaySet,
  year: number,
  month: number,
  nowMs: number,
) {
  const jobsById = new Map(settings.jobs.map((j) => [j.id, j]));

  const shifts = [...rawShifts]
    .sort((a, b) => a.start - b.start)
    .flatMap((r) => {
      const job = jobsById.get(r.jobId);
      if (!job) return [];
      return [{ ...calcShift(job, r, holidays), ...payInfo(job, jstParts(r.start)), done: r.end <= nowMs, job }];
    });

  // 交通費は同じバイト先・同じ日なら1回だけ
  const seen = new Set<string>();
  const withTransport = shifts.map((s) => {
    const k = `${s.jobId}|${s.date}`;
    const transport = seen.has(k) ? 0 : s.job.transport;
    seen.add(k);
    return { ...s, transport };
  });

  // 支給日ごとにまとめる
  const payMap = new Map<string, { payY: number; payM: number; item: SalaryIncoming }>();
  for (const s of withTransport) {
    const k = `${s.jobId}|${s.payDate}`;
    let entry = payMap.get(k);
    if (!entry) {
      entry = {
        payY: s.payY,
        payM: s.payM,
        item: {
          type: 'salary',
          name: s.jobName,
          payDate: s.payDate,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          count: 0,
          workMin: 0,
          gross: 0,
          transport: 0,
          total: 0,
        },
      };
      payMap.set(k, entry);
    }
    const p = entry.item;
    p.count++;
    p.workMin += s.workMin;
    p.gross += s.pay;
    p.transport += s.transport;
    p.total = p.gross + p.transport;
  }

  const incoming: Incoming[] = [...payMap.values()]
    .filter((p) => p.payY === year && p.payM === month)
    .map((p) => p.item);
  for (const a of settings.allowances) {
    if (a.amount <= 0) continue;
    incoming.push({
      type: 'allowance',
      name: a.name,
      payDate: ymdKey(year, month, clampDay(year, month, a.day)),
      total: a.amount,
    });
  }
  incoming.sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0));

  // その月に働いた分
  const monthShifts = withTransport.filter((s) => s.parts.y === year && s.parts.m === month);
  const workMap = new Map<number, WorkSummary>();
  for (const s of monthShifts) {
    let w = workMap.get(s.jobId);
    if (!w) {
      w = { name: s.jobName, count: 0, workMin: 0, pay: 0, transport: 0 };
      workMap.set(s.jobId, w);
    }
    w.count++;
    w.workMin += s.workMin;
    w.pay += s.pay;
    w.transport += s.transport;
  }

  // その年に支給される給与（交通費・仕送りは含めない）
  const byMonth = new Array<number>(12).fill(0);
  let yearDone = 0;
  let yearPlanned = 0;
  for (const s of withTransport) {
    if (s.payY !== year) continue;
    byMonth[s.payM - 1] += s.pay;
    if (s.done) yearDone += s.pay;
    else yearPlanned += s.pay;
  }

  const work = settings.jobs.flatMap((j) => workMap.get(j.id) ?? []);
  return {
    year,
    month,
    incoming,
    incomingTotal: incoming.reduce((t, x) => t + x.total, 0),
    work,
    workPayTotal: work.reduce((t, x) => t + x.pay, 0),
    workMinTotal: work.reduce((t, x) => t + x.workMin, 0),
    shifts: monthShifts.map((s) => ({
      date: s.date,
      dow: s.parts.dow,
      start: s.start,
      end: s.end,
      jobName: s.jobName,
      workMin: s.workMin,
      breakMin: s.breakMin,
      nightMin: s.nightMin,
      isWeekend: s.isWeekend,
      rate: s.rate,
      pay: s.pay,
      done: s.done,
    })),
    yearDone,
    yearPlanned,
    byMonth,
    wall: settings.wall,
  };
}
