import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpEnv } from './env';

// ライブラリは cloudflare: のモジュールを読むので Node では動かない。/callback で使うものだけ差し替える
vi.mock('@cloudflare/workers-oauth-provider', () => ({
  AuthorizationError: class extends Error {
    constructor(
      readonly redirectUri?: string,
      readonly redirectTo?: string,
    ) {
      super('invalid_request');
    }
  },
  CimdFetchError: class extends Error {},
  authorizationErrorRedirect: (request: { redirectUri: string }, error: string) =>
    `${request.redirectUri}?error=${error}`,
}));
const { handleAuth } = await import('./auth');
const { AuthorizationError } = await import('@cloudflare/workers-oauth-provider');

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

/** LINE ログインから戻ってきたところ。LINE への fetch は、userId を返す偽物にする */
function callback(redirectUri: string, lineUser: string, query = '?code=c&state=s') {
  const completeAuthorization = vi.fn(() => Promise.resolve({ redirectTo: `${redirectUri}?code=ok` }));
  const env = {
    OWNER_LINE_USER_ID: 'Uowner',
    LOGIN_CHANNEL_ID: '1',
    LOGIN_CHANNEL_SECRET: 's',
    PUBLIC_URL: 'https://mcp.example',
    OAUTH_PROVIDER: {
      finishUpstream: () =>
        Promise.resolve({
          request: { redirectUri, scope: ['kakeibo:read'] },
          data: { verifier: 'v' },
          headers: new Headers(),
        }),
      completeAuthorization,
    },
  } as unknown as McpEnv;
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(Response.json(url.includes('/token') ? { id_token: 'id' } : { sub: lineUser }, { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    run: () => handleAuth(new Request(`https://mcp.example/callback${query}`), env),
    completeAuthorization,
    fetchMock,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('/callback', () => {
  it('許していない戻り先には、エラーもトークンも返さず、LINE にも問い合わせない', async () => {
    for (const query of ['?code=c&state=s', '?error=access_denied&state=s']) {
      const c = callback('https://oauth-redirect.googleusercontent.com/r/attacker', 'Uowner', query);
      const res = await c.run();
      expect(res.status).toBe(400);
      expect(res.headers.get('Location')).toBeNull();
      expect(c.fetchMock).not.toHaveBeenCalled();
      expect(c.completeAuthorization).not.toHaveBeenCalled();
    }
  });

  it('許した戻り先で、LINE ログインをやめた・code がないときは access_denied で返す', async () => {
    for (const query of ['?error=access_denied&state=s', '?state=s']) {
      const c = callback(CLAUDE, 'Uowner', query);
      const res = await c.run();
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(`${CLAUDE}?error=access_denied`);
      expect(c.fetchMock).not.toHaveBeenCalled();
      expect(c.completeAuthorization).not.toHaveBeenCalled();
    }
  });

  it('持ち主でない LINE アカウントは access_denied で返す', async () => {
    const c = callback(CLAUDE, 'Uother');
    const res = await c.run();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${CLAUDE}?error=access_denied`);
    expect(c.completeAuthorization).not.toHaveBeenCalled();
  });

  it('許した戻り先で持ち主なら、トークンを出す', async () => {
    const c = callback(CLAUDE, 'Uowner');
    const res = await c.run();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${CLAUDE}?code=ok`);
    expect(c.completeAuthorization).toHaveBeenCalledOnce();
  });
});

describe('/authorize でライブラリがエラーを出したとき', () => {
  /** PKCE がないなど、ライブラリが戻り先へ返してよいとしたエラー */
  function authorize(redirectUri: string) {
    const env = {
      OAUTH_PROVIDER: {
        parseAuthRequest: () => {
          throw new (AuthorizationError as unknown as new (uri: string, to: string) => Error)(
            redirectUri,
            `${redirectUri}?error=invalid_request&state=s`,
          );
        },
      },
    } as unknown as McpEnv;
    return handleAuth(new Request('https://mcp.example/authorize?client_id=x'), env);
  }

  it('許していない戻り先には返さず、この画面で見せる', async () => {
    const res = await authorize('https://evil.example.com/cb');
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('許した戻り先には返す', async () => {
    const res = await authorize(CLAUDE);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${CLAUDE}?error=invalid_request&state=s`);
  });
});
