// だれが、どの AI アプリから家計簿につなげるか（ADR 0016）。ライブラリを読み込まないので Node のテストから呼べる

/**
 * ログインのあとに戻ってよい先（AI アプリ）。アプリの登録はだれでもできるので、
 * 似た名前の偽アプリに許可を渡しても、トークンが本物の AI アプリにしか届かないようにする。
 * ドメインでなく URL 全体で比べる。Gemini の戻り先は Google アカウントごとにパスが違い、
 * ドメインだけで許すと、ほかの人の Gemini にもトークンが届くため
 */
const FIXED_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  // Meta の Muse
  'https://agent.meta.ai/api/hatch/oauth/callback',
]);

/**
 * extraRedirects は、シークレット EXTRA_REDIRECT_URIS（カンマ区切り）。
 * 持ち主の Gemini の戻り先のように、個人の ID を含むものを公開リポジトリに書かずに足す
 */
export function allowedRedirect(redirectUri: string, extraRedirects = ''): boolean {
  if (FIXED_REDIRECTS.has(redirectUri)) return true;
  return extraRedirects
    .split(',')
    .map((s) => s.trim())
    .some((s) => s !== '' && s === redirectUri);
}

/** 家計簿の持ち主の LINE userId だけを通す。設定がなければだれも通さない */
export function isOwner(ownerUserId: string | undefined, userId: string): boolean {
  // シークレットを入れるときに付いた空白や改行で、持ち主まで締め出さないように
  const owner = ownerUserId?.trim();
  return !!owner && userId === owner;
}
