import { OAuthProvider, insufficientScope, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { handleAuth } from './auth';
import type { McpEnv } from './env';
import { READ, SCOPE_LABELS, WRITE, callsWriteTool } from './scopes';
import { createServer } from './tools';

/**
 * 外の AI（Claude・Gemini・Muse）から家計簿を使うための MCP サーバー（Issue #10）。
 * この Worker が OAuth の認証サーバーと MCP サーバー（/mcp）を兼ねる。ログインは LINE ログイン
 */
let provider: OAuthProvider<McpEnv> | undefined;

export default {
  fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    // 公開 URL は env にしかないので、最初のリクエストで作る
    provider ??= new OAuthProvider<McpEnv>({
      apiRoute: '/mcp',
      apiHandler: {
        async fetch(req, env, ctx) {
          // OAuthProvider が、確かめたトークン（auth）と completeAuthorization() の props を入れる
          const { auth, props } = ctx as OAuthResourceContext<{ userId?: string }>;
          if (!auth.scope.includes(READ)) return insufficientScope(auth, [READ]);
          const userId = props.userId;
          if (!userId) return new Response('no user', { status: 403 });
          // 書き込みの許可なしに書き込みのツールを呼んだら、403 で許可を求め直してもらう
          if (!auth.scope.includes(WRITE) && req.method === 'POST') {
            const body: unknown = await req
              .clone()
              .json()
              .catch(() => null);
            if (callsWriteTool(body)) return insufficientScope(auth, [READ, WRITE]);
          }
          return createMcpHandler(() => createServer(env, userId))(req, env, ctx);
        },
      },
      defaultHandler: { fetch: (req, env) => handleAuth(req, env) },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      // Claude は CIMD、Gemini・Muse は DCR でつなぐので両方を有効にする
      clientRegistrationEndpoint: '/oauth/register',
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [...Object.keys(SCOPE_LABELS), 'offline_access'],
      requiredScopes: [READ],
      resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL] },
    });
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<McpEnv>;
