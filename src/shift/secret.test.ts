import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, isGoogleIcalUrl } from './secret';

// テスト専用の鍵（本番の鍵ではない）
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const URL_ = 'https://calendar.google.com/calendar/ical/example%40group.calendar.google.com/private-0000/basic.ics';

describe('encryptText / decryptText', () => {
  it('暗号化して元に戻せる。毎回違う暗号文になる', async () => {
    const a = await encryptText(KEY, URL_);
    const b = await encryptText(KEY, URL_);
    expect(a).not.toContain('calendar.google.com');
    expect(a).not.toBe(b);
    expect(await decryptText(KEY, a)).toBe(URL_);
  });
  it('鍵が違うと戻せない', async () => {
    await expect(decryptText(OTHER_KEY, await encryptText(KEY, URL_))).rejects.toThrow();
  });
  it('書き換えられていると戻せない', async () => {
    const sealed = await encryptText(KEY, URL_);
    const tampered = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptText(KEY, tampered)).rejects.toThrow();
  });
  it('鍵の長さが違えば分かるように止める', async () => {
    await expect(encryptText(btoa('short'), URL_)).rejects.toThrow('ICAL_ENCRYPTION_KEY');
  });
});

describe('isGoogleIcalUrl', () => {
  it('Google カレンダーの iCal だけを受け付ける', () => {
    expect(isGoogleIcalUrl(URL_)).toBe(true);
    expect(isGoogleIcalUrl('http://calendar.google.com/calendar/ical/x/basic.ics')).toBe(false);
    expect(isGoogleIcalUrl('https://example.com/calendar/ical/x/basic.ics')).toBe(false);
    expect(isGoogleIcalUrl('https://calendar.google.com.evil.example/calendar/ical/x/basic.ics')).toBe(false);
    expect(isGoogleIcalUrl('https://calendar.google.com/calendar/embed?src=x')).toBe(false);
    expect(isGoogleIcalUrl('not a url')).toBe(false);
  });
});
