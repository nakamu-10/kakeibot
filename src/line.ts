import type { Env } from './types';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

/** Webhookの署名検証（x-line-signature） */
export async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // 長さ・内容の比較（タイミング差を小さくする）
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export type LineMessage = Record<string, unknown>;

export async function reply(env: Env, replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
  });
  if (!res.ok) console.error('reply failed', res.status, await res.text());
}

/** 「入力中…」のローディング表示（1対1トークのみ有効） */
export async function showLoading(env: Env, userId: string, seconds = 20): Promise<void> {
  await fetch(`${API}/chat/loading/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
  }).catch(() => {});
}

/** ユーザーが送った画像を取得 */
export async function getContent(env: Env, messageId: string): Promise<{ data: ArrayBuffer; mime: string }> {
  const res = await fetch(`${DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`content fetch failed: ${res.status}`);
  return { data: await res.arrayBuffer(), mime: res.headers.get('content-type') ?? 'image/jpeg' };
}

export function text(t: string, quickReply?: LineMessage[]): LineMessage {
  const m: LineMessage = { type: 'text', text: t };
  if (quickReply && quickReply.length) m.quickReply = { items: quickReply.slice(0, 13) };
  return m;
}

export function qrMessage(label: string, msg = label): LineMessage {
  return { type: 'action', action: { type: 'message', label: label.slice(0, 20), text: msg } };
}

export function qrPostback(label: string, data: string, displayText?: string): LineMessage {
  const action: Record<string, string> = { type: 'postback', label: label.slice(0, 20), data };
  if (displayText) action.displayText = displayText;
  return { type: 'action', action };
}

/** カメラを直接起動（レシート撮影用） */
export function qrCamera(label = 'レシート撮影'): LineMessage {
  return { type: 'action', action: { type: 'camera', label } };
}

export function qrUri(label: string, uri: string): LineMessage {
  return { type: 'action', action: { type: 'uri', label: label.slice(0, 20), uri } };
}

/** LIFFのIDトークンを検証して userId を返す */
export async function verifyIdToken(env: Env, idToken: string): Promise<string | null> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LOGIN_CHANNEL_ID }),
  });
  if (!res.ok) return null;
  const json = await res.json<{ sub?: string }>();
  return json.sub ?? null;
}
