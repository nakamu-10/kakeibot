import type { Env } from './types';
import { verifySignature } from './line';
import { handleEvent } from './bot';
import { handleApi } from './api';
import appHtml from './app.html';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // LINE Messaging API の Webhook
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const body = await req.text();
      const ok = await verifySignature(env.LINE_CHANNEL_SECRET, body, req.headers.get('x-line-signature'));
      if (!ok) return new Response('invalid signature', { status: 401 });

      const { events } = JSON.parse(body) as { events: Parameters<typeof handleEvent>[1][] };
      // LINEには即200を返し、処理はバックグラウンドで続ける（レシートAIは数秒かかるため）
      ctx.waitUntil(
        Promise.all(
          events.map((ev) =>
            handleEvent(env, ev).catch((e: unknown) => {
              console.error('event error', e);
            }),
          ),
        ),
      );
      return new Response('ok');
    }

    // LIFF画面
    if (url.pathname === '/' || url.pathname === '/app') {
      return new Response(appHtml.replace('__LIFF_ID__', env.LIFF_ID), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname.startsWith('/api/')) return handleApi(req, env, url);

    return new Response('not found', { status: 404 });
  },
};
