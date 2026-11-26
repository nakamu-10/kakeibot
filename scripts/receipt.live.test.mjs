// 本物の Gemini API でレシート画像を読み取ってみる。LINE の準備がなくても試せる
// 使い方: .dev.vars に GEMINI_API_KEY を書いてから
//         RECEIPT_IMAGE=./receipt.jpg npm run try:receipt
// RECEIPT_IMAGE がなければ飛ばす（npm test では走らない）
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/parse';
import { readReceipt } from '../src/receipt';
import { todayJST } from '../src/util';

const devVars = new URL('../.dev.vars', import.meta.url);
const fromDevVars = (name) =>
  existsSync(devVars)
    ? readFileSync(devVars, 'utf8')
        .match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
        ?.trim()
    : '';

const imagePath = process.env.RECEIPT_IMAGE;
const apiKey = process.env.GEMINI_API_KEY || fromDevVars('GEMINI_API_KEY');

it.skipIf(!imagePath)('レシート画像を読み取る', { timeout: 60_000 }, async () => {
  if (!apiKey) throw new Error('.dev.vars に GEMINI_API_KEY を書いてください');
  const image = readFileSync(imagePath);
  const mime = /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg';
  const env = { GEMINI_API_KEY: apiKey, RECEIPT_MODEL: process.env.RECEIPT_MODEL ?? '' };
  const categories = DEFAULT_CATEGORIES.filter((c) => c.type === 'expense').map((c) => c.name);

  const started = Date.now();
  const data = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
  const result = await readReceipt(env, data, mime, categories, todayJST());
  console.log(`${Date.now() - started}ms`, JSON.stringify(result, null, 2));
  expect(result).toHaveProperty('isReceipt');
});
