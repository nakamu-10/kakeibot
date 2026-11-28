// だれが、どの AI アプリから家計簿につなげるか（ADR 0016）。ライブラリを読み込まないので Node のテストから呼べる

/**
 * ログインのあとに戻ってよい先（AI アプリ）。アプリの登録はだれでもできるので、
 * 似た名前の偽アプリに許可を渡しても、トークンが本物の AI アプリにしか届かないようにする。
 * 新しい AI アプリをつなぐときは、ここに足してデプロイし直す
 */
const ALLOWED_REDIRECT_ORIGINS = new Set([
  'https://claude.ai',
  'https://claude.com',
  // Gemini アプリ
  'https://oauth-redirect.googleusercontent.com',
  // Meta の Muse
  'https://agent.meta.ai',
]);

export function allowedRedirect(redirectUri: string): boolean {
  try {
    return ALLOWED_REDIRECT_ORIGINS.has(new URL(redirectUri).origin);
  } catch {
    return false;
  }
}

/** 家計簿の持ち主の LINE userId だけを通す。設定がなければだれも通さない */
export function isOwner(ownerUserId: string | undefined, userId: string): boolean {
  return !!ownerUserId && userId === ownerUserId;
}
