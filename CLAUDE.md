# LINE家計簿ボット

LINEに「ランチ 800」と送るかレシートの写真を送ると記録できる家計簿ボット。グラフ・履歴・設定はLIFF画面で見る。
Cloudflare Workers + D1 + TypeScript。レシート読取は Gemini API（Interactions API の画像入力、無料枠）。

## コマンド

- 開発：`npm run dev`（初回は `cp .dev.vars.example .dev.vars` と `npm run db:init:local`）
- 確認：`npm run lint`、`npm run typecheck`、`npm test`、`npm run knip`
- 整形：`npm run format`
- Webhookを手で送る：`node scripts/webhook.mjs "ランチ 800"`（`npm run dev` 中に）
- ローカルDBを見る：`npx wrangler d1 execute kakeibo --local --command "SELECT * FROM entries"`

## 構成

- `src/index.ts`：ルーティング（`/webhook`、`/app`、`/api/*`）
- `src/bot.ts`：LINEイベント処理（テキスト・画像・ポストバック）と返信文
- `src/parse.ts`：「ランチ 800」の解析、日付指定、初期カテゴリとキーワード
- `src/receipt.ts`：レシート画像 → Gemini → JSON
- `src/db.ts`：D1へのアクセスはすべて `Repo` を通す
- `src/api.ts`：LIFF画面用API。`Authorization: Bearer <LIFFのIDトークン>` を `verifyIdToken` で検証して userId を得る
- `src/line.ts`：署名検証・返信・画像取得・クイックリプライ
- `src/shift/calc.ts`：シフトから給料・入金予定を計算する（純粋関数。時刻は日本時間固定）
- `src/app.html`：LIFF画面（素のJS + Chart.js、1ファイル）
- `schema.sql`：テーブル定義。変えたら既存DB向けの移行SQLも `migrations/` に置く

## 開発ルール

- 読みやすい名前と素直なコードを選ぶ。共通化は本当に同じ処理だけ
- コメントは必要な「なぜ」だけを書く
- 書き直したら、使わなくなったファイル・export・依存を消す。「あとで使う」コードは残さない
- 処理を足す・変えるときは、テストも足す（`src/*.test.ts`、vitest）。純粋な関数に切り出してテストする
- ライブラリやLINE APIは、書く前に今の版のドキュメントを確かめる。deprecatedな書き方を避ける
- 設計上の決定は`docs/adr/`に1件ずつ残す
- 日付は日本時間の `'YYYY-MM-DD'` 文字列で扱う（`util.ts` の `todayJST`）。金額は円の整数
- ユーザーへの返信文は日本語・敬体・絵文字なし（記録時の「✓」だけ使う）
- LIFF画面は落ち着いた表中心のデザイン。アイコン多用・巨大な数字・角丸カードの多用はしない

## この環境での確かめ方

- LINEやGeminiのAPIには外から届かないことがある。返信や画像取得が失敗しても、DBへの書き込みと `npm test` で確かめる
- 実機の確認（LINEでの返信、LIFF画面）はユーザーがする。PRの「どう確かめたか」に、手で確かめてほしい点を書く

## commit

- commitは、それだけで意味が通り、lintと型が通る単位に分ける
- 整形・名前の変更は、機能の変更と別のcommitにする
- メッセージは`feat: 〜する`の形（`fix`・`docs`・`chore`・`refactor`など）。本文に「なぜ」を書く
- mainに直接pushせず、ブランチを切ってPRを出す

## してはいけないこと

- `.dev.vars`・`.env`をcommitしない。環境変数を足したら`.dev.vars.example`と`wrangler.toml`のコメントも更新する
- 秘密の値（チャネルシークレット・アクセストークン・APIキー）を `app.html` や `[vars]` に書かない
- `wrangler deploy`、`wrangler secret`、`--remote` 付きのD1操作はしない（本番に触る操作はユーザーがする）
- force push、`--no-verify`はしない
- 依存の追加と`git push`は、実行する前に確認する

## 次にやること

README.md の「次にやること」を参照。優先度順：

1. LINEグループでの共有家計簿・割り勘精算（均等割り・収入比率などの傾斜割り、メンバー別の支出比較、精算ボタン）
2. 買い物メモ（グループで共有するチェックリスト）
3. PayPay取引履歴CSVの取り込み（明細を選んで取り込み、カテゴリは個別に変更可）
4. 記録忘れ通知（Cron Triggers）
