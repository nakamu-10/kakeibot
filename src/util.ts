/** 日本時間の今日 'YYYY-MM-DD' */
export function todayJST(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM' */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 'YYYY-MM' から n か月ずらす */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function yen(n: number): string {
  return (n < 0 ? '-¥' : '¥') + Math.abs(n).toLocaleString('ja-JP');
}

/** 全角英数・記号を半角に、カンマ・円記号を除去 */
export function normalize(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[＋]/g, '+')
    .replace(/[－−](?=\d)/g, '-')
    .replace(/[，,](?=\d{3})/g, '')
    .replace(/[¥￥]/g, '')
    .trim();
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
