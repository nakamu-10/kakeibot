import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

/** MCP サーバー（mcp/wrangler.toml）の環境変数とバインディング */
export interface McpEnv {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  /** この Worker の URL（例: https://kakeibot-mcp.example.workers.dev）。末尾に / を付けない */
  PUBLIC_URL: string;
  /** LIFF と同じ LINE ログインチャネル（同じ userId にするため） */
  LOGIN_CHANNEL_ID: string;
  LOGIN_CHANNEL_SECRET: string;
  /** AI とつなげる家計簿の持ち主の LINE userId（シークレット。公開リポジトリに書かない）。なければだれもつなげない */
  OWNER_LINE_USER_ID?: string;
  /** 決まった戻り先（Claude・Muse）のほかに許す戻り先（シークレット、カンマ区切り）。持ち主の Gemini の戻り先など */
  EXTRA_REDIRECT_URIS?: string;
  /** シフト収入のカレンダーを読むため（ボットと同じ鍵） */
  ICAL_ENCRYPTION_KEY: string;
  /** OAuthProvider が入れる */
  OAUTH_PROVIDER: OAuthHelpers;
}
