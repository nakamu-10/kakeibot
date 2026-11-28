# LINE家計簿ボット

LINEに「ランチ 800」と送るかレシートの写真を送ると記録できる家計簿ボット。グラフ・履歴・設定はLIFF画面で見る。
Cloudflare Workers + D1 + TypeScript。レシート読取は Gemini API（Interactions API の画像入力、無料枠）。

## コマンド

- 開発：`npm run dev`（初回は `cp .dev.vars.example .dev.vars` と `npm run db:init:local`）
- 確認：`npm run check`（整形・lint・knip・型・テスト・2つの Worker のバンドル）。これが通れば PR を出してよい
- 個別：`npm run lint`、`npm run typecheck`、`npm test`、`npm run knip`、`npm run build`
- 整形：`npm run format`
- Webhookを手で送る：`node scripts/webhook.mjs "ランチ 800"`（`npm run dev` 中に）
- LIFF画面を手元で見る：`node scripts/preview.mjs` → `http://localhost:8790/app`（架空のデータ。LINE ログインは要らない）
- ローカルDBを見る：`npx wrangler d1 execute kakeibo --local --command "SELECT * FROM entries"`

## 構成

- `src/index.ts`：ルーティング（`/webhook`、`/app`、`/api/*`）
- `src/bot.ts`：LINEイベント処理（テキスト・画像・ポストバック）と返信文
- `src/parse.ts`：「ランチ 800」の解析、日付指定、初期カテゴリとキーワード
- `src/category.ts`：カテゴリの親子（2段まで）。並び順・親にできるか・親でまとめた集計
- `src/receipt.ts`：レシート画像 → Gemini → JSON
- `src/db.ts`：D1へのアクセスはすべて `Repo` を通す
- `src/api.ts`：LIFF画面用API。`Authorization: Bearer <LIFFのIDトークン>` を `verifyIdToken` で検証して userId を得る
- `src/line.ts`：署名検証・返信・画像取得・クイックリプライ・プッシュ
- `src/changes.ts`：AI が加えた変更の履歴と取り消し（1回の依頼ごと。その後に人が直したものは戻さない）。MCP で記録や設定を変えるツールは、必ず `recordChanges` で残す
- `src/fixed.ts`：固定費・サブスク（毎月へのならし・候補探し・払う日）。`src/fixedDaily.ts`：払う日の朝に家計簿へ記録する（給料日と同じ Cron）
- `src/goals.ts`：貯金の目標と見通し（画面と AI で同じ `loadGoals`）。`src/assets.ts`：口座と月の残高、純資産・分け方・推移（ADR 0014）
- `src/remind.ts`：記録忘れ通知（Cron Trigger、毎晩21時。`src/index.ts` の `scheduled` で crons ごとに分ける）
- `src/shift/`：シフト収入
  - `calc.ts`：シフトから給料・入金予定を計算する（純粋関数。時刻は日本時間固定）
  - `ical.ts`：iCal → 予定。単純な予定は自前で読み、繰り返しだけ ical.js で展開する（Workers の CPU 時間のため）
  - `match.ts`：ひとつのカレンダーの予定を、タイトルに含まれる言葉でバイト先に振り分ける
  - `secret.ts`：iCal の非公開URLの暗号化。URL は API から返さず、ログにも出さない
  - `report.ts`：カレンダーと祝日を読んで月のレポートを作る（LIFF・トークの「収入」・給料日の通知で共通）
  - `text.ts`：トークの返信文と通知文。`payday.ts`：給料日・仕送りの日に家計簿へ記録し、通知する（Cron Trigger、毎朝8時）
  - `api.ts`：`/api/shift/*`。`holidays.ts`：祝日（holidays-jp）
- `src/shift.html`：シフト収入のLIFF画面（`/app/shift`）
- `mcp/`：外の AI（Claude・Gemini・Muse）向けの MCP サーバー。ボットとは別の Worker（`mcp/wrangler.toml`、`npm run dev:mcp`）
  - `index.ts`：OAuth の認証サーバーと `/mcp` を兼ねる（`OAuthProvider`）。`auth.ts`：許可の画面と LINE ログイン。`consent.ts`：画面と PKCE（Node で試せる）
  - `tools.ts`：MCP のツール。D1 は `Repo` を通し、集計やシフト計算は `src/` のものを使う。`scopes.ts`：AI に許すこと
  - ツールを足すときは、読み取りか書き込みかでスコープと `annotations`（`readOnlyHint`・`destructiveHint`）を付ける
- `src/app.html`：LIFF画面（素のJS + Chart.js、1ファイル）
- `src/ui.css`：LIFF画面で共通の見た目（色・カード・ボタン・入力欄・ナビ）。`/app/ui.css` で配る
- `schema.sql`：テーブル定義。変えたら既存DB向けの移行SQLも `migrations/` に置く

## 開発ルール

- 読みやすい名前と素直なコードを選ぶ。共通化は本当に同じ処理だけ
- コメントは必要な「なぜ」だけを書く。区切り線や★・【】で飾らない
- 書き直したら、使わなくなったファイル・export・依存を消す。「あとで使う」コードは残さない
- 処理を足す・変えるときは、テストも足す（`src/*.test.ts`、vitest）。純粋な関数に切り出してテストする
- ライブラリやLINE APIは、書く前に今の版のドキュメントを確かめる。deprecatedな書き方を避ける
- 設計上の決定は`docs/adr/`に1件ずつ残す
- 日付は日本時間の `'YYYY-MM-DD'` 文字列で扱う（`util.ts` の `todayJST`）。金額は円の整数
- ユーザーへの返信文は日本語・敬体・絵文字なし（記録時の「✓」だけ使う）
- LIFF画面は LINE になじむ、大きめで角の丸い柔らかい見た目（ADR 0009）。色は `src/ui.css` の変数だけを使う。アイコンは多用しない
- 入力欄の文字は 16px 以上（iPhone が入力のたびに拡大しないように）。押せるものは高さ 44px 以上
- ブラウザの `alert`・`confirm`・`prompt` は使わない。知らせは `toast`、入力は下から出る入力欄、削除は2回押す
- 画面を変えたら `node scripts/preview.mjs` で、スマホの幅で見て確かめる
- 作業の初めに `docs/HANDOFF.md` を読み、終わりに「今の状態」と「次にすること」を更新する。急がないタスクと相談は GitHub Issues に書く

## 書き方の例

- コメントには、コードを読んでも分からない理由だけを書く
  - 書く：`// 16px 未満だと iPhone が入力のたびに拡大する`
  - 書かない：`// 金額を保存する`（次の行を読めば分かる）
- ファイルの頭に処理の流れを書き並べない。流れは関数の名前と分け方で見せる
- 番号付きのコメントで区切るほど長い関数は、関数に分ける
- 使わなくなったコードは、コメントアウトで残さずに消す
- 日本語の文に、言い直しや前置きを書かない。1文には1つのことだけを書く
  - 書く：`給料日の朝に、見込み額を収入として記録する。`
  - 書かない：`ここでは給料日の処理を行います。具体的には、見込み額を収入として記録する処理となっています。`

## 本番

- 本番の状態はコードから推測しない。`docs/HANDOFF.md` の日付つきの記述か、外から読むだけの確認（`curl` など）で確かめてから話す
- デプロイ・シークレット・`--remote` の D1 操作はユーザーが手で行う（Claude には `.claude/settings.json` で禁止）
- 移行 SQL は `migrations/` に番号順に足すだけにする。適用済みのファイルは書き換えない。デプロイより先に流してもらう

## この環境での確かめ方

- LINEやGeminiのAPIには外から届かないことがある。返信や画像取得が失敗しても、DBへの書き込みと `npm test` で確かめる
- 実機の確認（LINEでの返信、LIFF画面）はユーザーがする。PRの「どう確かめたか」に、手で確かめてほしい点を書く

## commit

- commitは、それだけで意味が通り、lintと型が通る単位に分ける
- 整形・名前の変更は、機能の変更と別のcommitにする
- メッセージは`feat: 〜する`の形（`fix`・`docs`・`chore`・`refactor`など）。本文に「なぜ」を書く
- mainに直接pushせず、ブランチを切ってPRを出す
- PRは小さくする（目安は差分150行まで。生成物とテストの架空のデータは数えない）

## レビュー

ひとりで開発しているので、人のレビューの代わりに次の順で確かめてからマージする。

1. CI（static・test・build・secrets）が全部通る
2. PR を作った会話の記憶を持たない Claude で `/code-review <PR番号> --comment` を実行し、機械的なバグやテストの抜けを PR にコメントさせる
   - 別のセッションか、会話を引き継がないサブエージェント（`general-purpose` など）を使う。`fork` は使わない
   - サブエージェントに渡すのは PR の番号と手順だけにする。作った経緯を渡すと、思い込みが移る。渡した指示の全文を PR にコメントで残す
   - 直して処理の流れや条件が変わったら、PR の番号と直した commit の SHA だけを渡し、その commit だけをもう一度レビューさせる。3回目でも指摘が出たら、ユーザーに相談する
3. ユーザーが GitHub の画面で、差分全体を他人が書いたつもりで読む
4. 本番のデータ・鍵・認証・移行 SQL に関わる PR は、一晩おいて読み直してからマージする

- Claude は、ユーザーがその PR を「マージしてよい」と言ったときだけマージする
- 急ぎで手順を省くときは、省いた手順と理由を PR にコメントしてからマージする

## してはいけないこと

- `.dev.vars`・`.env`をcommitしない。環境変数を足したら`.dev.vars.example`と`wrangler.toml`のコメントも更新する
- 秘密の値（チャネルシークレット・アクセストークン・APIキー）を `app.html` や `[vars]` に書かない
- `wrangler deploy`、`wrangler secret`、`--remote` 付きのD1操作はしない（「本番」の節）
- force push、`--no-verify`はしない
- 依存の追加と`git push`は、実行する前に確認する

## 次にやること

`docs/HANDOFF.md` の「次にすること」と GitHub Issues を見る。
