import { describe, expect, it } from 'vitest';
import { jstMidnight } from './calc';
import { parseShifts, rangeForYear, readSimpleEvent, trimToRange } from './ical';

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

describe('trimToRange', () => {
  it('繰り返しのない期間外の予定だけを先に落とす', () => {
    const out = trimToRange(ICS, rangeForYear(2026));
    expect(out).not.toContain('old@example.com');
    expect(out).toContain('weekly@example.com');
    expect(out).toContain('single@example.com');
  });

  /** 2022-01-05（水）17:00-20:00 から始まる繰り返し */
  const series = (rrule: string) =>
    [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Asia/Tokyo:20220105T170000',
      'DTEND;TZID=Asia/Tokyo:20220105T200000',
      `RRULE:${rrule}`,
      'UID:old-series@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  /** 2022-01-05 から every 日ごとの、期間内の開始時刻 */
  const expected = (every: number) => {
    const range = rangeForYear(2026);
    const out: number[] = [];
    for (let t = jst(2022, 1, 5, 17); t < range.to; t += every * 86_400_000) if (t >= range.from) out.push(t);
    return out;
  };

  it('昔から続く毎週の繰り返しを進めても、期間内の回は同じ', () => {
    expect(trimToRange(series('FREQ=WEEKLY'), rangeForYear(2026))).not.toContain('20220105');
    expect(parseShifts(series('FREQ=WEEKLY'), 1, rangeForYear(2026)).map((s) => s.start)).toEqual(expected(7));
  });
  it('隔週や毎日でも周期がずれない', () => {
    expect(parseShifts(series('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE'), 1, rangeForYear(2026)).map((s) => s.start)).toEqual(
      expected(14),
    );
    expect(parseShifts(series('FREQ=DAILY;INTERVAL=3'), 1, rangeForYear(2026)).map((s) => s.start)).toEqual(
      expected(3),
    );
  });
  it('期間より前に終わった繰り返しは落とし、回数指定はそのまま', () => {
    expect(trimToRange(series('FREQ=WEEKLY;UNTIL=20230101T000000Z'), rangeForYear(2026))).not.toContain('VEVENT');
    expect(trimToRange(series('FREQ=WEEKLY;COUNT=500'), rangeForYear(2026))).toContain('20220105');
  });
});

describe('rangeForYear', () => {
  it('前年9月1日から年末まで（日本時間）', () => {
    expect(rangeForYear(2026)).toEqual({ from: jstMidnight(2025, 9, 1), to: jstMidnight(2027, 1, 1) });
  });
});

describe('readSimpleEvent', () => {
  it('折り返し・エスケープされた説明欄を読む', () => {
    const block = [
      'BEGIN:VEVENT',
      'DTSTART:20261101T090000',
      'DTEND:20261101T120000',
      'DESCRIPTION:メモ\\, 早番\\n休',
      ' 憩30',
      'END:VEVENT',
    ].join('\r\n');
    expect(readSimpleEvent(block)).toEqual({
      start: jst(2026, 11, 1, 9),
      end: jst(2026, 11, 1, 12),
      description: 'メモ, 早番\n休憩30',
    });
  });
  it('日本時間・UTC 以外のタイムゾーンは ical.js に任せる', () => {
    const block = [
      'BEGIN:VEVENT',
      'DTSTART;TZID=America/New_York:20261101T090000',
      'DTEND;TZID=America/New_York:20261101T120000',
      'END:VEVENT',
    ].join('\r\n');
    expect(readSimpleEvent(block)).toBeUndefined();
  });
});
