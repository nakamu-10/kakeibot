// リッチメニューを作成してデフォルトに設定する
// 使い方: LINE_CHANNEL_ACCESS_TOKEN=xxx LIFF_ID=yyy node scripts/richmenu.mjs
import { readFile } from 'node:fs/promises';

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.LIFF_ID;
if (!token || !liffId) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN と LIFF_ID を環境変数で渡してください');
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };
const W = 2500, H = 843, cw = Math.floor(W / 3);

const menu = {
  size: { width: W, height: H },
  selected: true,
  name: 'kakeibo-main',
  chatBarText: 'メニュー',
  areas: [
    { bounds: { x: 0, y: 0, width: cw, height: H }, action: { type: 'message', text: '今月' } },
    { bounds: { x: cw, y: 0, width: cw, height: H }, action: { type: 'uri', uri: `https://liff.line.me/${liffId}` } },
    { bounds: { x: cw * 2, y: 0, width: W - cw * 2, height: H }, action: { type: 'message', text: 'ヘルプ' } },
  ],
};

const create = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(menu),
});
const { richMenuId } = await create.json();
if (!richMenuId) throw new Error('作成に失敗しました');
console.log('richMenuId:', richMenuId);

const img = await readFile(new URL('./richmenu.png', import.meta.url));
const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'image/png' },
  body: img,
});
if (!up.ok) throw new Error('画像アップロード失敗: ' + (await up.text()));

const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: auth });
if (!def.ok) throw new Error('デフォルト設定失敗: ' + (await def.text()));
console.log('リッチメニューを設定しました');
