import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { SCOPE_LABELS } from './scopes';

// 認証の画面と PKCE（ライブラリを読み込まないので、Node のテストからも呼べる）

// ---------- PKCE ----------
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** 43文字の code_verifier（LINE は 43〜128 文字） */
export function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// ---------- 画面 ----------
// AI アプリの名前やスコープは相手が決められる値なので、必ずエスケープする
export const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** どの AI アプリに、何を許すかを見せて、LINE ログインに進ませる */
export function consentPage(details: ConsentDescription, handle: string): string {
  const origin = details.clientDomain
    ? `<strong>${escape(details.clientDomain)}</strong> が公開しているアプリです。`
    : 'このアプリの名前は、アプリが自分で名乗ったもので、確かめられていません。';
  const scopes = details.scope
    .filter((s) => s in SCOPE_LABELS)
    .map(
      (s) =>
        `<label class="scope"><input type="checkbox" name="scope" value="${escape(s)}" checked> ${escape(SCOPE_LABELS[s])}</label>`,
    )
    .join('');
  const loopback = details.redirectIsLoopback
    ? '<p class="warn">このパソコンの中のアプリに許可を渡します。自分で今つなごうとしたときだけ進めてください。</p>'
    : '';
  return html(
    // 見出しは html() がエスケープする
    `${details.clientName} を家計簿につなぎますか？`,
    `<p>${origin}</p>
    <p>許可すると、<strong>${escape(details.redirectHost)}</strong> にあなたの家計簿を使う権限が渡されます。</p>
    ${loopback}
    <form method="post">
      <input type="hidden" name="handle" value="${escape(handle)}">
      ${scopes}
      <button class="primary" name="decision" value="approve">LINE でログインして許可する</button>
      <button class="secondary" name="decision" value="deny">やめる</button>
    </form>`,
  );
}

export function page(title: string, body: string, status = 200): Response {
  return new Response(html(title, body), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function html(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #f2f4f6; color: #1a1d21; font: 16px/1.7 'Hiragino Maru Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', sans-serif; }
  main { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 24px 20px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .scope { display: flex; gap: 10px; align-items: center; min-height: 48px; font-size: 17px; }
  .scope input { width: 22px; height: 22px; accent-color: #06b860; }
  .warn { background: #fde8e8; color: #e5484d; border-radius: 14px; padding: 12px 14px; }
  button { display: block; width: 100%; min-height: 52px; margin-top: 12px; border: none; border-radius: 999px; font: inherit; font-weight: 700; }
  .primary { background: #06b860; color: #fff; }
  .secondary { background: #f2f4f6; color: #1a1d21; }
</style></head>
<body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}
