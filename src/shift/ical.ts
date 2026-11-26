import ICAL from 'ical.js';
import { jstMidnight, parseBreakOverride, type RawShift } from './calc';

const JST_OFFSET = 9 * 3600_000;
const DAY_MS = 86_400_000;
// 壊れた繰り返し予定で止まらないように
const MAX_OCCURRENCES = 5000;

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

/**
 * 繰り返しのない予定のうち、期間の外にあるものを先に落とす。
 * 非公開iCalは過去の予定もすべて入っていて、全部をパースすると Workers の CPU 時間を食うため
 */
export function dropEventsOutside(ics: string, range: Range): string {
  const from = dayKey(range.from - DAY_MS);
  const to = dayKey(range.to + DAY_MS);
  return ics.replace(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT\r?\n?/g, (block) => {
    if (/^(RRULE|RECURRENCE-ID)[;:]/m.test(block)) return block;
    const start = /^DTSTART[^:\r\n]*:(\d{8})/m.exec(block)?.[1];
    if (!start) return block;
    return start >= from && start <= to ? block : '';
  });
}

/** UNIX ミリ秒 → 日本時間の 'YYYYMMDD' */
function dayKey(ms: number): string {
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}

/** タイムゾーンのない時刻（floating）は日本時間とみなす */
function toMs(t: ICAL.Time): number {
  if (t.zone === ICAL.Timezone.localTimezone) {
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - JST_OFFSET;
  }
  return t.toUnixTime() * 1000;
}

const cancelled = (c: ICAL.Component) => String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

/**
 * iCal のテキストから、期間内に始まるシフトを取り出す。
 * 繰り返し（RRULE・EXDATE・1回だけ変更した予定）を展開し、終日の予定と取り消された予定は除く
 */
export function parseShifts(ics: string, jobId: number, range: Range): RawShift[] {
  const root = new ICAL.Component(ICAL.parse(dropEventsOutside(ics, range)) as unknown[]);
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

  const shifts: RawShift[] = [];
  const add = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event) => {
    if (start.isDate || cancelled(item.component)) return;
    const s = toMs(start);
    if (s < range.from || s >= range.to) return;
    shifts.push({ jobId, start: s, end: toMs(end), breakOverride: parseBreakOverride(item.description) });
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
      if (!next || toMs(next) >= range.to) break;
      const d = event.getOccurrenceDetails(next);
      add(d.startDate, d.endDate, d.item);
    }
  }
  return shifts.sort((a, b) => a.start - b.start);
}
