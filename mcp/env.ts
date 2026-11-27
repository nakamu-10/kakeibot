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
  /** シフト収入のカレンダーを読むため（ボットと同じ鍵） */
  ICAL_ENCRYPTION_KEY: string;
  /** OAuthProvider が入れる */
  OAUTH_PROVIDER: OAuthHelpers;
}
