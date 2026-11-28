import type { Env } from './types';
import { verifySignature } from './line';
import { handleEvent } from './bot';
import { handleApi } from './api';
import appHtml from './app.html';
import shiftHtml from './shift.html';
import uiCss from './ui.css';
import { runPaydays } from './shift/payday';
import { runFixedCosts } from './fixedDaily';
import { runReminders } from './remind';

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

    // LIFF 画面の共通の見た目
    if (url.pathname === '/app/ui.css') {
      return new Response(uiCss, {
        headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }

    // シフト収入のページ。LIFF のエンドポイント /app の下に置き、liff.line.me/<LIFF ID>/shift で開けるようにする
    if (url.pathname === '/app/shift') {
      return new Response(shiftHtml.replace('__LIFF_ID__', env.LIFF_ID), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname.startsWith('/api/')) return handleApi(req, env, url);

    return new Response('not found', { status: 404 });
  },

  // Cron Trigger（wrangler.toml の crons と同じ文字列で分ける）
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const now = new Date(controller.scheduledTime);
    // 毎朝8時（日本時間）：給料日・仕送りの日の記録と通知
    if (controller.cron === '0 23 * * *') {
      ctx.waitUntil(runPaydays(env, now));
      ctx.waitUntil(runFixedCosts(env, now));
    }
    // 毎晩21時（日本時間）：記録忘れ通知
    if (controller.cron === '0 12 * * *') ctx.waitUntil(runReminders(env, now));
  },
};
