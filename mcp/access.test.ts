import { describe, expect, it } from 'vitest';
import { allowedRedirect, isOwner, maskUserId } from './access';

const GEMINI_OWNER = 'https://oauth-redirect.googleusercontent.com/r/owner-connector-id';

describe('allowedRedirect', () => {
  it('Claude・Muse の決まった戻り先と、シークレットで足した戻り先だけを通す', () => {
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(allowedRedirect('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(allowedRedirect('https://agent.meta.ai/api/hatch/oauth/callback')).toBe(true);
    expect(allowedRedirect(GEMINI_OWNER, ` ${GEMINI_OWNER} ,https://example.com/x`)).toBe(true);
  });
  it('同じドメインでもほかのパス（ほかの人の Gemini など）は通さない', () => {
    expect(allowedRedirect('https://oauth-redirect.googleusercontent.com/r/attacker-connector-id', GEMINI_OWNER)).toBe(
      false,
    );
    expect(allowedRedirect('https://claude.ai/other/callback')).toBe(false);
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
  });
  it('似た名前・http・知らないドメイン・空のシークレットは通さない', () => {
    expect(allowedRedirect('https://evil.example.com/callback', '')).toBe(false);
    expect(allowedRedirect('https://claude.ai.evil.example.com/api/mcp/auth_callback')).toBe(false);
    expect(allowedRedirect('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(allowedRedirect('', ',,')).toBe(false);
  });
});

describe('isOwner', () => {
  it('持ち主の userId だけ。設定がなければだれも通さない', () => {
    expect(isOwner('Uowner', 'Uowner')).toBe(true);
    expect(isOwner('Uowner', 'Uother')).toBe(false);
    expect(isOwner(undefined, 'Uowner')).toBe(false);
    expect(isOwner('', '')).toBe(false);
  });
  it('シークレットに付いた空白や改行は無視する', () => {
    expect(isOwner('Uowner\n', 'Uowner')).toBe(true);
    expect(isOwner('  ', '')).toBe(false);
  });
});

describe('maskUserId', () => {
  it('前の3文字と後ろの4文字だけ出す', () => {
    expect(maskUserId('U1234567890abcdef1234567890abcdef')).toBe('U12…cdef');
    expect(maskUserId(' Uabc\n')).toBe('…');
    expect(maskUserId(undefined)).toBe('(なし)');
  });
});
