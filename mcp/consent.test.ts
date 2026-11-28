import { describe, expect, it } from 'vitest';
import { codeChallenge, consentPage, escape, randomVerifier } from './consent';

describe('PKCE', () => {
  it('RFC 7636 の例と同じ code_challenge になる', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('code_verifier は 43 文字で、使える文字だけ', () => {
    const v = randomVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(randomVerifier()).not.toBe(v);
  });
});

describe('consentPage', () => {
  const details = {
    clientName: '<script>alert(1)</script>',
    clientDomain: 'claude.ai',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    redirectHost: 'claude.ai',
    redirectIsLoopback: false,
    scope: ['kakeibo:read', 'unknown:scope'],
  };

  it('アプリが名乗った名前はエスケープする', () => {
    const html = consentPage(details as never, 'h1');
    expect(html).not.toContain('<script>');
    expect(html).toContain(escape('<script>'));
  });
  it('見るのはいつも許し、書き込みは選べる（初めはオン）。知らないスコープは出さない', () => {
    const html = consentPage(details as never, 'h1');
    expect(html).toContain('<input type="hidden" name="scope" value="kakeibo:read">');
    // 読むだけのつもりで書き込みまで渡さないように、初めはオフ
    expect(html).toContain('<input type="checkbox" name="scope" value="kakeibo:write">');
    expect(html).not.toContain('unknown:scope');
    expect(html).toContain('<strong>claude.ai</strong>');
  });
  it('アプリが offline_access を求めたら引き継ぐ', () => {
    expect(consentPage({ ...details, scope: ['kakeibo:read', 'offline_access'] } as never, 'h1')).toContain(
      'value="offline_access"',
    );
  });
  it('このパソコンのアプリに渡すときは注意を出す', () => {
    expect(consentPage({ ...details, redirectIsLoopback: true } as never, 'h1')).toContain('このパソコンの中のアプリ');
  });
});
