/**
 * iCal の非公開URLを D1 に暗号化して置く（AES-GCM）。
 * 鍵は wrangler secret の ICAL_ENCRYPTION_KEY（32バイトを base64 にしたもの）。
 * D1 の中身だけが漏れても、URL からシフトを読まれないようにするため
 */

const VERSION = 'v1';

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('ICAL_ENCRYPTION_KEY は32バイトを base64 にした値にしてください');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 'v1:<iv>:<暗号文>'（どちらも base64） */
export async function encryptText(keyBase64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyBase64);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(data))}`;
}

/** 鍵が違う・書き換えられているときは例外 */
export async function decryptText(keyBase64: string, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(':');
  if (version !== VERSION || !iv || !data) throw new Error('暗号文の形式が違います');
  const key = await importKey(keyBase64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(data));
  return new TextDecoder().decode(plain);
}

/** Google カレンダーの iCal の URL だけを受け付ける（思わぬ宛先へ fetch させないため） */
export function isGoogleIcalUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'calendar.google.com' &&
      u.pathname.startsWith('/calendar/ical/') &&
      u.pathname.endsWith('.ics')
    );
  } catch {
    return false;
  }
}
