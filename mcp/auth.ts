import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider';
import { codeChallenge, consentPage, escape, page, randomVerifier } from './consent';
import type { McpEnv } from './env';

const LINE_AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY = 'https://api.line.me/oauth2/v2.1/verify';

/**
 * AI アプリ（Claude など）からの接続を許可する画面と、LINE ログイン。
 * GET /authorize で許可の画面を出し、POST /authorize で許可されたら LINE ログインへ。
 * /callback で LINE から戻り、LINE の userId を家計簿の持ち主としてトークンを出す
 */
export async function handleAuth(req: Request, env: McpEnv): Promise<Response> {
  const url = new URL(req.url);
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (url.pathname === '/authorize' && req.method === 'GET') {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }

    if (url.pathname === '/authorize' && req.method === 'POST') {
      const form = await req.formData();
      const handle = String(form.get('handle'));
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(req, handle, { scope: form.getAll('scope').map(String) });
      // 許可されてから LINE ログインへ（AI アプリごとの許可を先に取る）
      const verifier = randomVerifier();
      const { state, headers } = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      headers.set('Location', lineAuthorizeUrl(env, state, await codeChallenge(verifier)));
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === '/callback') {
      const { request, data, headers } = await oauth.finishUpstream<{ verifier: string }>(req);
      const code = url.searchParams.get('code');
      if (url.searchParams.get('error') || !code) {
        headers.set('Location', authorizationErrorRedirect(request, 'access_denied'));
        return new Response(null, { status: 302, headers });
      }
      const userId = await lineUserId(env, code, data.verifier);
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId,
        metadata: {},
        scope: request.scope,
        props: { userId },
      });
      headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === '/') {
      return page(
        '家計簿の MCP サーバー',
        `<p>AI アプリ（Claude など）のコネクタに <code>${escape(env.PUBLIC_URL)}/mcp</code> を登録して使います。</p>`,
      );
    }
    return new Response('not found', { status: 404 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message =
        error instanceof AuthorizationError
          ? 'この画面は使えなくなりました。AI アプリから、もう一度つなぎ直してください。'
          : 'このアプリを確かめられませんでした。';
      return page('つなげませんでした', `<p>${escape(message)}</p>`, 400);
    }
    throw error;
  }
}

function lineAuthorizeUrl(env: McpEnv, state: string, challenge: string): string {
  const u = new URL(LINE_AUTHORIZE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.LOGIN_CHANNEL_ID);
  u.searchParams.set('redirect_uri', `${env.PUBLIC_URL}/callback`);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'openid profile');
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  // LINE の例は scope を %20 で区切る（URLSearchParams は空白を + にするため直す）
  return u.toString().replace(/\+/g, '%20');
}

/** LINE ログインのコードを ID トークンに替え、LINE の userId（sub）を得る */
async function lineUserId(env: McpEnv, code: string, verifier: string): Promise<string> {
  const token = await fetch(LINE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.PUBLIC_URL}/callback`,
      client_id: env.LOGIN_CHANNEL_ID,
      client_secret: env.LOGIN_CHANNEL_SECRET,
      code_verifier: verifier,
    }),
  });
  if (!token.ok) throw new Error(`LINE token failed: ${token.status}`);
  const { id_token } = await token.json<{ id_token?: string }>();
  if (!id_token) throw new Error('LINE token has no id_token');
  const verified = await fetch(LINE_VERIFY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token, client_id: env.LOGIN_CHANNEL_ID }),
  });
  if (!verified.ok) throw new Error(`LINE verify failed: ${verified.status}`);
  const { sub } = await verified.json<{ sub?: string }>();
  if (!sub) throw new Error('LINE id_token has no sub');
  return sub;
}
