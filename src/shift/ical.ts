import ICAL from 'ical.js';
import { jstMidnight } from './calc';

const JST_OFFSET = 9 * 3600_000;
const DAY_MS = 86_400_000;
// 壊れた繰り返し予定で止まらないように
const MAX_OCCURRENCES = 5000;
const VEVENT = /BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT\r?\n?/g;

/** 対象期間 [from, to)（UNIX ミリ秒） */
export interface Range {
  from: number;
  to: number;
}

/**
 * 年 year の画面に要るシフトの期間。
 * 翌々月払いの分まで拾うため前年9月から、その年の年末まで
 */
export function rangeForYear(year: number): Range {
  return { from: jstMidnight(year - 1, 9, 1), to: jstMidnight(year + 1, 1, 1) };
}

/** カレンダーの予定1回分（時刻は UNIX ミリ秒） */
export interface CalendarEvent {
  start: number;
  end: number;
  title: string;
  description: string;
}

type Push = (start: number, end: number, title: string | null, description: string | null) => void;

/**
 * iCal のテキストから、期間内に始まる予定を取り出す。
 * 繰り返し（RRULE・EXDATE・1回だけ変更した予定）を展開し、終日の予定と取り消された予定は除く
 */
export function parseEvents(ics: string, range: Range): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const push: Push = (start, end, title, description) => {
    if (start < range.from || start >= range.to) return;
    events.push({ start, end, title: title ?? '', description: description ?? '' });
  };

  // 単純な予定は先に自前で読み、残り（繰り返しと、自前で読めない形）だけを ical.js に渡す。
  // ical.js は1件あたりが重く、何年分もの予定を全部渡すと Workers の CPU 時間を超えるため
  const rest = ics.replace(VEVENT, (block) => {
    if (/^(RRULE|RECURRENCE-ID)[;:]/m.test(block)) return block;
    const e = readSimpleEvent(block);
    if (e === undefined) return block;
    if (e !== 'skip') push(e.start, e.end, e.title, e.description);
    return '';
  });
  if (/BEGIN:VEVENT/.test(rest)) readWithIcalJs(trimToRange(rest, range), range.to, push);
  return events.sort((a, b) => a.start - b.start);
}

/**
 * 繰り返しのない予定を ical.js を通さずに読む。
 * 終日・取り消しは 'skip'。日本時間・UTC・タイムゾーンなし以外の形は undefined を返して ical.js に任せる
 */
export function readSimpleEvent(block: string): CalendarEvent | 'skip' | undefined {
  const text = block.replace(/\r?\n[ \t]/g, ''); // 折り返された行をつなぐ
  if (/^STATUS:CANCELLED\s*$/im.test(text)) return 'skip';
  const prop = (name: string) => new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*?)\\r?$`, 'm').exec(text);
  const dtstart = prop('DTSTART');
  const dtend = prop('DTEND');
  if (!dtstart || !dtend) return undefined;
  const start = timeValue(dtstart[1], dtstart[2]);
  const end = timeValue(dtend[1], dtend[2]);
  if (start === 'date' || end === 'date') return 'skip';
  if (start === undefined || end === undefined) return undefined;
  // iCal のエスケープ（\n \, \; \\）を戻す
  const textValue = (name: string) =>
    (prop(name)?.[2] ?? '').replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
  return { start, end, title: textValue('SUMMARY'), description: textValue('DESCRIPTION') };
}

/** DTSTART・DTEND の値 → UNIX ミリ秒。日付だけなら 'date'、自前で読めない形なら undefined */
function timeValue(params: string, value: string): number | 'date' | undefined {
  if (/VALUE=DATE(;|$)/i.test(params) || /^\d{8}$/.test(value)) return 'date';
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return undefined;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7] === 'Z') return wall;
  const tzid = /TZID="?([^;:"]+)/i.exec(params)?.[1];
  // タイムゾーンのない時刻（floating）は日本時間とみなす
  return !tzid || tzid === 'Asia/Tokyo' ? wall - JST_OFFSET : undefined;
}

/**
 * ical.js に渡す前に、期間に関係ない部分を文字列のまま減らす
 * - 繰り返しのない予定は、期間の外なら落とす
 * - 期間より前に終わった繰り返しは落とす
 * - 毎日・毎週の繰り返しは、開始日を周期の倍数だけ期間の直前まで進める（展開する回数を減らす）
 */
export function trimToRange(ics: string, range: Range): string {
  const from = dayKey(range.from - DAY_MS);
  const to = dayKey(range.to + DAY_MS);
  return ics.replace(VEVENT, (block) => {
    if (/^RECURRENCE-ID[;:]/m.test(block)) return block;
    const start = /^DTSTART[^:\r\n]*:(\d{8})/m.exec(block)?.[1];
    if (!start) return block;
    const rrule = /^RRULE:(.*)$/m.exec(block)?.[1];
    if (!rrule) return start >= from && start <= to ? block : '';

    const until = /UNTIL=(\d{8})/.exec(rrule)?.[1];
    if (until && until < from) return '';
    // 回数指定（COUNT）は、開始日を動かすと終わりがずれるのでそのまま
    if (/COUNT=/.test(rrule)) return block;
    const freq = /FREQ=(\w+)/.exec(rrule)?.[1];
    const interval = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
    const period = freq === 'WEEKLY' ? 7 * interval : freq === 'DAILY' ? interval : 0;
    if (!period) return block;
    // 1周期ぶん余裕を残して進める
    const skip = (Math.floor(daysBetween(start, from) / period) - 1) * period;
    if (skip <= 0) return block;
    return block.replace(/^(DTSTART|DTEND)([^:\r\n]*):(\d{8})/gm, (_, name: string, params: string, day: string) => {
      return `${name}${params}:${addDays(day, skip)}`;
    });
  });
}

/** UNIX ミリ秒 → 日本時間の 'YYYYMMDD' */
function dayKey(ms: number): string {
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}

const ymdToUtc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
const daysBetween = (a: string, b: string) => Math.round((ymdToUtc(b) - ymdToUtc(a)) / DAY_MS);
const addDays = (s: string, n: number) =>
  new Date(ymdToUtc(s) + n * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * ICAL.Time → UNIX ミリ秒。日本時間・UTC は自前で計算する（ical.js のタイムゾーン変換は重いため）。
 * タイムゾーンのない時刻（floating）は日本時間とみなす
 */
function toMs(t: ICAL.Time): number {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const zone = t.zone;
  if (zone === ICAL.Timezone.utcTimezone) return wall;
  if (zone === ICAL.Timezone.localTimezone || zone.tzid === 'Asia/Tokyo') return wall - JST_OFFSET;
  return t.toUnixTime() * 1000;
}

const cancelled = (c: ICAL.Component) => String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

/** 繰り返し予定を ical.js で展開する（rangeTo で止める。期間の始まりより前は push 側で落とす） */
function readWithIcalJs(ics: string, rangeTo: number, push: Push): void {
  const root = new ICAL.Component(ICAL.parse(ics) as unknown[]);
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  // UID ごとに、元の予定と「1回だけ変更」の予定に分ける
  const groups = new Map<string, { master?: ICAL.Component; exceptions: ICAL.Component[] }>();
  for (const c of root.getAllSubcomponents('vevent')) {
    const uid = String(c.getFirstPropertyValue('uid') ?? '');
    const g = groups.get(uid) ?? { exceptions: [] };
    if (c.hasProperty('recurrence-id')) g.exceptions.push(c);
    else g.master = c;
    groups.set(uid, g);
  }

  const add = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event) => {
    if (start.isDate || cancelled(item.component)) return;
    push(toMs(start), toMs(end), item.summary, item.description);
  };

  for (const { master, exceptions } of groups.values()) {
    // 元の予定がファイルにない「1回だけ変更」は、単発の予定として扱う
    if (!master) {
      for (const c of exceptions) {
        const e = new ICAL.Event(c);
        add(e.startDate, e.endDate, e);
      }
      continue;
    }
    const event = new ICAL.Event(master, { exceptions });
    if (!event.isRecurring()) {
      add(event.startDate, event.endDate, event);
      continue;
    }
    const it = event.iterator();
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      // 型は Time だが、繰り返しが終わると undefined が返る
      const next = it.next() as ICAL.Time | undefined;
      if (!next || toMs(next) >= rangeTo) break;
      const d = event.getOccurrenceDetails(next);
      add(d.startDate, d.endDate, d.item);
    }
  }
}
