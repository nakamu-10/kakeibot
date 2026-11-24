import type { Env } from './types';
import { arrayBufferToBase64 } from './util';

export interface ReceiptResult {
  isReceipt: boolean;
  store: string;
  date: string | null; // 'YYYY-MM-DD'
  total: number;
  category: string;
  items: { name: string; price: number }[];
}

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** レシート画像をClaudeで読み取る */
export async function readReceipt(
  env: Env,
  image: ArrayBuffer,
  mime: string,
  expenseCategories: string[],
  today: string,
): Promise<ReceiptResult> {
  const mediaType = SUPPORTED.includes(mime) ? mime : 'image/jpeg';
  const prompt = `この画像がレシートなら内容を読み取り、次のJSONだけを出力してください（説明文やコードブロックは不要）。
{
  "is_receipt": true,
  "store": "店名（不明なら空文字）",
  "date": "YYYY-MM-DD（読めなければ null）",
  "total": 合計金額の整数（税込・支払総額。値引き後）,
  "category": "次のどれか1つ: ${expenseCategories.join(' / ')}",
  "items": [{"name": "品名", "price": 整数}]
}
- 今日は ${today} です。年が省略されていれば今日に近い年を補ってください。
- レシートでない画像なら {"is_receipt": false} だけを返してください。
- items は主なものを最大10件まで。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.RECEIPT_MODEL || 'claude-haiku-5-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: arrayBufferToBase64(image) } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  const raw = json.content.find((c) => c.type === 'text')?.text ?? '';
  return parseReceiptJson(raw, expenseCategories);
}

export function parseReceiptJson(raw: string, expenseCategories: string[]): ReceiptResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSONが見つかりません: ' + raw.slice(0, 200));
  const o = JSON.parse(match[0]) as Record<string, unknown>;
  if (o.is_receipt === false) {
    return { isReceipt: false, store: '', date: null, total: 0, category: '', items: [] };
  }
  const total = Math.round(Number(o.total) || 0);
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  const cat = typeof o.category === 'string' && expenseCategories.includes(o.category) ? o.category : (expenseCategories.includes('その他') ? 'その他' : expenseCategories[0]);
  const items = Array.isArray(o.items)
    ? (o.items as { name?: unknown; price?: unknown }[])
        .map((i) => ({ name: String(i.name ?? ''), price: Math.round(Number(i.price) || 0) }))
        .filter((i) => i.name)
    : [];
  return { isReceipt: total > 0, store: String(o.store ?? ''), date, total, category: cat, items };
}
