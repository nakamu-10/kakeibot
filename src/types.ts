export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  GEMINI_API_KEY: string;
  LIFF_ID: string;
  LOGIN_CHANNEL_ID: string;
  RECEIPT_MODEL: string;
  ICAL_ENCRYPTION_KEY: string;
}

export type EntryType = 'expense' | 'income';

export interface Category {
  id: number;
  name: string;
  type: EntryType;
  sort: number;
  keywords: string;
  /** 親カテゴリの id。0 なら一番上の段 */
  parentId: number;
}

export interface Entry {
  id: number;
  type: EntryType;
  category: string;
  amount: number;
  memo: string;
  store: string;
  date: string;
  source: string;
}
