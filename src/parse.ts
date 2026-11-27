import type { EntryType } from './types';
import { normalize } from './util';

export interface CategoryLite {
  name: string;
  type: EntryType;
  keywords: string;
}

/** 新規ユーザーに入れる初期カテゴリ */
export const DEFAULT_CATEGORIES: CategoryLite[] = [
  {
    name: '食費',
    type: 'expense',
    keywords:
      'ランチ,昼,昼食,朝食,夕食,夜ご飯,晩ご飯,ごはん,ご飯,コンビニ,スーパー,カフェ,コーヒー,スタバ,マック,弁当,パン,おやつ,外食,学食,牛丼,ラーメン',
  },
  {
    name: '日用品',
    type: 'expense',
    keywords: 'ドラッグストア,薬局,洗剤,ティッシュ,トイレットペーパー,シャンプー,ダイソー,100均,ニトリ',
  },
  {
    name: '交通費',
    type: 'expense',
    keywords: '電車,バス,タクシー,suica,pasmo,チャージ,ガソリン,駐車場,定期,新幹線,高速',
  },
  { name: '交際費', type: 'expense', keywords: '飲み会,飲み,プレゼント,ご祝儀,デート,誕生日' },
  { name: '趣味', type: 'expense', keywords: '本,漫画,ゲーム,映画,カラオケ,ライブ,パーツ,ガジェット,amazon,アマゾン' },
  { name: '衣服', type: 'expense', keywords: '服,靴,ユニクロ,gu,洋服' },
  { name: '美容', type: 'expense', keywords: '美容院,散髪,床屋,化粧品,コスメ' },
  { name: '医療', type: 'expense', keywords: '病院,歯医者,薬,通院' },
  { name: '住居', type: 'expense', keywords: '家賃,管理費' },
  { name: '光熱費', type: 'expense', keywords: '電気,ガス,水道' },
  { name: '通信費', type: 'expense', keywords: 'スマホ,携帯,wifi,ネット,サブスク' },
  { name: 'その他', type: 'expense', keywords: '' },
  { name: '給与', type: 'income', keywords: '給料,バイト代,バイト,給与,賞与,ボーナス' },
  { name: '副業', type: 'income', keywords: '副業,売上,報酬' },
  { name: '仕送り', type: 'income', keywords: '仕送り' },
  { name: 'お小遣い', type: 'income', keywords: '小遣い,お年玉' },
  { name: 'その他収入', type: 'income', keywords: '臨時収入,返金,メルカリ' },
];

/**
 * 先頭の日付指定を取り出す：「昨日 ランチ 800」「おととい …」「11/20 …」「2026/11/20 …」
 * 見つからなければ today を返す。
 */
export function extractDate(input: string, today: string): { date: string; rest: string } {
  const s = normalize(input);
  const shift = (days: number) => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const rel: [RegExp, number][] = [
    [/^(昨日|きのう)\s*/, -1],
    [/^(一昨日|おととい)\s*/, -2],
    [/^(今日|きょう)\s*/, 0],
  ];
  for (const [re, n] of rel) if (re.test(s)) return { date: shift(n), rest: s.replace(re, '') };

  const m = s.match(/^(?:(\d{4})[/\-.])?(\d{1,2})[/\-.月](\d{1,2})日?\s+/);
  if (m) {
    const [ty, tm] = today.split('-').map(Number);
    const mo = Number(m[2]);
    const da = Number(m[3]);
    // 年省略時、未来の月なら去年扱い（1月に「12/30」と送った場合など）
    const y = m[1] ? Number(m[1]) : mo > tm ? ty - 1 : ty;
    const d = new Date(Date.UTC(y, mo - 1, da));
    if (d.getUTCMonth() === mo - 1 && d.getUTCDate() === da) {
      return { date: d.toISOString().slice(0, 10), rest: s.slice(m[0].length) };
    }
  }
  return { date: today, rest: s };
}

export interface ParsedEntry {
  type: EntryType;
  category: string;
  amount: number;
  memo: string;
}

/**
 * 「ランチ 800」「スーパー 2,480」「800 ランチ」「+給料 50000」「収入 バイト 30000」などを解析。
 * 金額が見つからなければ null。
 */
export function parseEntry(input: string, categories: CategoryLite[]): ParsedEntry | null {
  let s = normalize(input);
  let forceIncome = false;

  if (s.startsWith('+')) {
    forceIncome = true;
    s = s.slice(1).trim();
  } else if (/^収入\s*/.test(s)) {
    forceIncome = true;
    s = s.replace(/^収入\s*/, '');
  }

  // 「ランチ 800」「ランチ800円」/「800 ランチ」「800円ランチ」
  const tail = s.match(/^(.*?)\s*(\d{1,9})\s*円?$/);
  const head = s.match(/^(\d{1,9})\s*円?\s*(\D.*)$/);
  let label: string;
  let amountStr: string;
  if (tail && tail[1] !== '') [label, amountStr] = [tail[1], tail[2]];
  else if (head) [label, amountStr] = [head[2], head[1]];
  else if (tail) [label, amountStr] = ['', tail[2]];
  else return null;

  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  label = label.trim();

  const pick = (type?: EntryType) => categories.filter((c) => !type || c.type === type);
  const pool = forceIncome ? pick('income') : pick();

  // 1. カテゴリ名そのもの（「食費 800」）または「食費 ランチ 800」
  const [first, ...rest] = label.split(/\s+/);
  const byName = pool.find((c) => c.name === first);
  if (byName) {
    return { type: byName.type, category: byName.name, amount, memo: rest.join(' ') };
  }

  // 2. キーワード一致（長いキーワード優先）
  const lower = label.toLowerCase();
  let best: { c: CategoryLite; len: number } | null = null;
  for (const c of pool) {
    for (const kw of c.keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)) {
      if (lower.includes(kw) && (!best || kw.length > best.len)) best = { c, len: kw.length };
    }
  }
  if (best) return { type: best.c.type, category: best.c.name, amount, memo: label };

  // 3. 見つからない → その他
  if (forceIncome) {
    const other = pick('income').find((c) => c.name === 'その他収入') ?? pick('income').at(0);
    return { type: 'income', category: other?.name ?? 'その他収入', amount, memo: label };
  }
  const other = pick('expense').find((c) => c.name === 'その他') ?? pick('expense').at(0);
  return { type: 'expense', category: other?.name ?? 'その他', amount, memo: label };
}

/** 金額だけの入力（「6500」「6,500円」）。normalize 済みの文字列を受け取る */
export function parseAmountOnly(t: string): number | null {
  const m = /^(\d{1,9})\s*円?$/.exec(t);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}
