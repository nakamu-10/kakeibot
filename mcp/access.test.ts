import { describe, expect, it } from 'vitest';
import { allowedRedirect, isOwner } from './access';

describe('allowedRedirect', () => {
  it('Claude・Gemini・Muse に戻るときだけ通す', () => {
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(allowedRedirect('https://oauth-redirect.googleusercontent.com/connector/callback')).toBe(true);
    expect(allowedRedirect('https://agent.meta.ai/oauth/callback')).toBe(true);
  });
  it('似た名前・http・ほかのポート・読めない URL は通さない', () => {
    expect(allowedRedirect('https://evil.example.com/callback')).toBe(false);
    expect(allowedRedirect('https://claude.ai.evil.example.com/callback')).toBe(false);
    expect(allowedRedirect('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(allowedRedirect('https://claude.ai:8443/callback')).toBe(false);
    expect(allowedRedirect('not a url')).toBe(false);
  });
});

describe('isOwner', () => {
  it('持ち主の userId だけ。設定がなければだれも通さない', () => {
    expect(isOwner('Uowner', 'Uowner')).toBe(true);
    expect(isOwner('Uowner', 'Uother')).toBe(false);
    expect(isOwner(undefined, 'Uowner')).toBe(false);
    expect(isOwner('', '')).toBe(false);
  });
});
