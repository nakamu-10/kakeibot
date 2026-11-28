import { describe, expect, it } from 'vitest';
import { balanceRemindText } from './remind';
import { jstDayStartUtc } from './util';

describe('jstDayStartUtc', () => {
  it('日本時間の0時は、UTC では前の日の15時', () => {
    expect(jstDayStartUtc('2026-11-28')).toBe('2026-11-27 15:00:00');
    expect(jstDayStartUtc('2027-01-01')).toBe('2026-12-31 15:00:00');
  });
});

describe('balanceRemindText', () => {
  it('まだの口座を並べる', () => {
    expect(balanceRemindText(['ゆうちょ', '楽天証券 NISA'])).toBe(
      '今月の残高を入れましょう。まだの口座：ゆうちょ、楽天証券 NISA\n家計簿の「資産」から入れるか、AI に伝えてください。',
    );
  });
});
