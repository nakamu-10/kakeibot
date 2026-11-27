import { parseBreakOverride, type Job, type RawShift } from './calc';
import type { CalendarEvent } from './ical';

/** 全角・半角と大文字・小文字の違いをならす */
const fold = (s: string) => s.normalize('NFKC').toLowerCase();

/** バイト先の判定に使う言葉。空ならバイト先の名前 */
export function jobKeywords(job: Job): string[] {
  const words = job.keywords
    .split(/[,、，]/)
    .map((w) => fold(w.trim()))
    .filter(Boolean);
  return words.length ? words : [fold(job.name)];
}

/**
 * ひとつのカレンダーの予定を、タイトルでバイト先に振り分ける。
 * 複数のバイト先に当てはまるときは、長い言葉で当たった方。どれにも当たらない予定は unmatched
 */
export function assignJobs(events: CalendarEvent[], jobs: Job[]): { shifts: RawShift[]; unmatched: CalendarEvent[] } {
  const rules = jobs.flatMap((job) => jobKeywords(job).map((word) => ({ job, word })));
  rules.sort((a, b) => b.word.length - a.word.length);
  const shifts: RawShift[] = [];
  const unmatched: CalendarEvent[] = [];
  for (const e of events) {
    const title = fold(e.title);
    const hit = rules.find((r) => title.includes(r.word));
    if (!hit) {
      unmatched.push(e);
      continue;
    }
    shifts.push({ jobId: hit.job.id, start: e.start, end: e.end, breakOverride: parseBreakOverride(e.description) });
  }
  return { shifts, unmatched };
}
