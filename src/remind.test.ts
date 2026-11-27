import { describe, expect, it } from 'vitest';
import { jstDayStartUtc } from './util';

describe('jstDayStartUtc', () => {
  it('日本時間の0時は、UTC では前の日の15時', () => {
    expect(jstDayStartUtc('2026-11-28')).toBe('2026-11-27 15:00:00');
    expect(jstDayStartUtc('2027-01-01')).toBe('2026-12-31 15:00:00');
  });
});
