// `npm run dev` で起動したローカルのWorkerに、署名付きのLINE Webhookを送る
// 使い方: node scripts/webhook.mjs "ランチ 800"
//         node scripts/webhook.mjs --postback "action=undo&id=1"
// LINEへの返信APIは外に出られない環境だと失敗するが、DBへの書き込みは確かめられる
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const secret =
  process.env.LINE_CHANNEL_SECRET ??
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^LINE_CHANNEL_SECRET=(.*)$/m)?.[1];
if (!secret) throw new Error('.dev.vars に LINE_CHANNEL_SECRET がありません');

const args = process.argv.slice(2);
const source = { type: 'user', userId: process.env.USER_ID ?? 'Utest' };
const event =
  args[0] === '--postback'
    ? { type: 'postback', replyToken: 'r', source, postback: { data: args[1] } }
    : { type: 'message', replyToken: 'r', source, message: { type: 'text', id: '1', text: args.join(' ') } };

const body = JSON.stringify({ events: [event] });
const signature = createHmac('sha256', secret).update(body).digest('base64');
const res = await fetch(process.env.WEBHOOK_URL ?? 'http://localhost:8787/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-line-signature': signature },
  body,
});
console.log(res.status, await res.text());
