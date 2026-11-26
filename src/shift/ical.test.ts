import { describe, expect, it } from 'vitest';
import { jstMidnight } from './calc';
import { dropEventsOutside, parseShifts, rangeForYear } from './ical';

// Google カレンダーの非公開iCalに似せた架空のデータ
const ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-TIMEZONE:Asia/Tokyo',
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tokyo',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
  // 毎週水曜 17:00-20:00。11/11 はお休み（EXDATE）、11/18 は 18:00-22:00 に変更して説明欄に休憩
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Tokyo:20261104T170000',
  'DTEND;TZID=Asia/Tokyo:20261104T200000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=4',
  'EXDATE;TZID=Asia/Tokyo:20261111T170000',
  'UID:weekly@example.com',
  'SUMMARY:バイト',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Tokyo:20261118T180000',
  'DTEND;TZID=Asia/Tokyo:20261118T220000',
  'RECURRENCE-ID;TZID=Asia/Tokyo:20261118T170000',
  'UID:weekly@example.com',
  'DESCRIPTION:休憩30',
  'SUMMARY:バイト',
  'END:VEVENT',
  // UTC で書かれた単発（日本時間 11/28 9:00-13:00）
  'BEGIN:VEVENT',
  'DTSTART:20261128T000000Z',
  'DTEND:20261128T040000Z',
  'UID:single@example.com',
  'END:VEVENT',
  // 終日の予定は無視する
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261120',
  'DTEND;VALUE=DATE:20261121',
  'UID:allday@example.com',
  'END:VEVENT',
  // 取り消された予定
  'BEGIN:VEVENT',
  'DTSTART:20261129T000000Z',
  'DTEND:20261129T040000Z',
  'STATUS:CANCELLED',
  'UID:cancelled@example.com',
  'END:VEVENT',
  // ずっと前の予定は期間外
  'BEGIN:VEVENT',
  'DTSTART:20200105T000000Z',
  'DTEND:20200105T040000Z',
  'UID:old@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const jst = (y: number, m: number, d: number, h: number) => jstMidnight(y, m, d) + h * 3600_000;

describe('parseShifts', () => {
  const shifts = parseShifts(ICS, 7, rangeForYear(2026));

  it('繰り返しを展開し、休み・変更・単発を反映する', () => {
    expect(shifts.map((s) => [s.start, s.end])).toEqual([
      [jst(2026, 11, 4, 17), jst(2026, 11, 4, 20)],
      [jst(2026, 11, 18, 18), jst(2026, 11, 18, 22)],
      [jst(2026, 11, 25, 17), jst(2026, 11, 25, 20)],
      [jst(2026, 11, 28, 9), jst(2026, 11, 28, 13)],
    ]);
  });
  it('変更した回だけ説明欄の休憩を使う', () => {
    expect(shifts.map((s) => s.breakOverride)).toEqual([null, 30, null, null]);
    expect(shifts.every((s) => s.jobId === 7)).toBe(true);
  });
  it('期間の外は返さない', () => {
    expect(parseShifts(ICS, 7, rangeForYear(2015))).toEqual([]);
  });
});

describe('dropEventsOutside', () => {
  it('繰り返しのない期間外の予定だけを先に落とす', () => {
    const out = dropEventsOutside(ICS, rangeForYear(2026));
    expect(out).not.toContain('old@example.com');
    expect(out).toContain('weekly@example.com');
    expect(out).toContain('single@example.com');
  });
});

describe('rangeForYear', () => {
  it('前年9月1日から年末まで（日本時間）', () => {
    expect(rangeForYear(2026)).toEqual({ from: jstMidnight(2025, 9, 1), to: jstMidnight(2027, 1, 1) });
  });
});
