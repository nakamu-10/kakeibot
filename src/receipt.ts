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

/** 無料枠の回数上限に達したとき。ユーザーに「時間をおいて」と伝えるため区別する */
export class ReceiptQuotaError extends Error {}

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    is_receipt: { type: 'boolean' },
    store: { type: 'string', description: '店名。不明なら空文字' },
    date: { type: 'string', description: 'YYYY-MM-DD。読めなければ空文字' },
    total: { type: 'integer', description: '合計金額（税込・支払総額。値引き後）' },
    category: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, price: { type: 'integer' } },
        required: ['name', 'price'],
      },
    },
  },
  required: ['is_receipt', 'store', 'date', 'total', 'category', 'items'],
};

/** レシート画像をGeminiで読み取る */
export async function readReceipt(
  env: Env,
  image: ArrayBuffer,
  mime: string,
  expenseCategories: string[],
  today: string,
): Promise<ReceiptResult> {
  const mimeType = SUPPORTED.includes(mime) ? mime : 'image/jpeg';
  const prompt = `この画像がレシートなら内容を読み取ってください。
- category は次のどれか1つ: ${expenseCategories.join(' / ')}
- 今日は ${today} です。年が省略されていれば今日に近い年を補ってください。
- レシートでない画像なら is_receipt を false にし、ほかは空文字・0・空配列にしてください。
- items は主なものを最大10件まで。`;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
      'api-revision': '2026-05-20',
    },
    body: JSON.stringify({
      model: env.RECEIPT_MODEL || 'gemini-3.8-flash',
      input: [
        { type: 'text', text: prompt },
        { type: 'image', data: arrayBufferToBase64(image), mime_type: mimeType },
      ],
      // 家計の情報なので、Google側に会話として保存させない
      store: false,
      generation_config: { thinking_level: 'low', max_output_tokens: 4096 },
      response_format: { type: 'text', mime_type: 'application/json', schema: RECEIPT_SCHEMA },
    }),
  });
  if (res.status === 429) throw new ReceiptQuotaError(`Gemini API 429: ${await res.text()}`);
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  return parseReceiptJson(extractInteractionText(await res.json()), expenseCategories);
}

interface Interaction {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

/** Interactions APIの応答から、モデルが出力したテキストを取り出す */
export function extractInteractionText(json: unknown): string {
  const o = json as Interaction;
  if (o.status !== 'completed') throw new Error(`Gemini interaction status: ${String(o.status)}`);
  const text = (o.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  if (!text) throw new Error('Geminiの応答にテキストがありません');
  return text;
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
  const cat =
    typeof o.category === 'string' && expenseCategories.includes(o.category)
      ? o.category
      : expenseCategories.includes('その他')
        ? 'その他'
        : expenseCategories[0];
  const items = Array.isArray(o.items)
    ? (o.items as { name?: unknown; price?: unknown }[])
        .map((i) => ({ name: typeof i.name === 'string' ? i.name : '', price: Math.round(Number(i.price) || 0) }))
        .filter((i) => i.name)
    : [];
  return { isReceipt: total > 0, store: typeof o.store === 'string' ? o.store : '', date, total, category: cat, items };
}
