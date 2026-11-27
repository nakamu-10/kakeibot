import { describe, expect, it } from 'vitest';
import { sanitizeJob } from './calc';
import { assignJobs, jobKeywords } from './match';

const cafe = sanitizeJob({ id: 1, name: '珈琲館', keywords: '珈琲館, コーヒー' });
const juku = sanitizeJob({ id: 2, name: '塾' });
const jukuOnline = sanitizeJob({ id: 3, name: 'オンライン塾', keywords: 'オンライン塾' });

const ev = (title: string, description = '') => ({ start: 0, end: 3_600_000, title, description });

describe('jobKeywords', () => {
  it('言葉が空ならバイト先の名前を使う', () => {
    expect(jobKeywords(juku)).toEqual(['塾']);
    expect(jobKeywords(cafe)).toEqual(['珈琲館', 'コーヒー']);
  });
});

describe('assignJobs', () => {
  it('タイトルに含まれる言葉でバイト先に振り分ける', () => {
    const { shifts, unmatched } = assignJobs(
      [ev('珈琲館 早番'), ev('塾', '休憩30'), ev('コーヒー'), ev('歯医者')],
      [cafe, juku],
    );
    expect(shifts.map((s) => [s.jobId, s.breakOverride])).toEqual([
      [1, null],
      [2, 30],
      [1, null],
    ]);
    expect(unmatched.map((e) => e.title)).toEqual(['歯医者']);
  });
  it('複数に当てはまるときは長い言葉の方', () => {
    expect(assignJobs([ev('オンライン塾')], [juku, jukuOnline]).shifts[0].jobId).toBe(3);
  });
  it('全角・半角や大文字・小文字の違いは気にしない', () => {
    const job = sanitizeJob({ id: 4, name: 'Cafe A' });
    expect(assignJobs([ev('ｃａｆｅ ａ 遅番')], [job]).shifts).toHaveLength(1);
  });
});
