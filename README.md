# LINE家計簿ボット

LINEに「ランチ 800」と送るだけで記録できる家計簿ボット。レシートの写真を送るとAI（Gemini）が読み取ります。
Cloudflare Workers + D1 で動き、グラフ・履歴・設定はLIFF画面（LINE内で開くWebページ）で見ます。

## できること（v0.1）

| 機能         | 内容                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| テキスト入力 | 「ランチ 800」「スーパー 2,480」「800 ランチ」「食費 800」「趣味 ガンプラ 3000」                                                                       |
| 収入         | 「+給料 50000」「収入 バイト 30000」「バイト代 42000」                                                                                                 |
| 日付指定     | 「昨日 ランチ 800」「おととい …」「11/20 本 1200」                                                                                                     |
| まとめて記録 | 改行して1行に1件ずつ送ると、まとめて記録（日付だけの行は次の行からの日付）                                                                             |
| レシート読取 | 写真を送るとAIが店名・合計・日付・カテゴリを判定して記録                                                                                               |
| 記録後の操作 | クイックリプライで「取り消す」「カテゴリ変更」「今月」「レシート撮影」「グラフ」                                                                       |
| コマンド     | 今月 / 先月 / 予算 50000 / 予算 / 取り消し / カテゴリ / グラフ / 収入 / 通知オン / 通知オフ / ヘルプ                                                   |
| 記録忘れ通知 | オンにすると、その日まだ記録していない夜9時に LINE で知らせる（最初はオフ）                                                                            |
| LIFF画面     | 月の収支・予算残り、日別グラフ、カテゴリ別グラフ、6か月推移、月比較、履歴の追加・編集・削除、予算設定、カテゴリ追加・編集・並び替え・削除、CSV書き出し |
| シフト収入   | Google カレンダーのシフトから、給料日ごとの入金予定・月の勤務・年間の支給額を計算（LIFF の `/app/shift`）                                              |

カテゴリの自動判定はカテゴリごとの「キーワード」で行います（例：食費 ← ランチ, コンビニ, スタバ…）。設定画面から自由に編集できます。

カテゴリは親と子の2段に分けられます（例：日用品 › 服・雑貨）。設定画面でカテゴリを追加するときに親を選ぶか、編集で親を変えます。トークでは「服 3000」「日用品 服 3000」のどちらでも子に記録でき、集計は親でまとめて子の内訳を出します。

## セットアップ

### 1. LINE側の準備

Messaging APIチャネルは、LINE Developers コンソールからは直接作れません（2024年9月から）。LINE公式アカウントを作ってから、Messaging APIを有効にします。

1. **LINE公式アカウント**を作る
   - [LINE Business ID](https://account.line.biz/signup) に登録し、[作成フォーム](https://entry.line.biz/form/entry/unverified)からアカウントを作る
2. [LINE Official Account Manager](https://manager.line.biz/) で **Messaging APIを有効にする**（設定 → Messaging API）
   - プロバイダーを選ぶ（新しく作ってよい）。**あとから変えられない**。次のLINEログインチャネルも同じプロバイダーに作る
   - 応答設定で「応答メッセージ」と「あいさつメッセージ」をオフにする（ボットの返信と二重になるため）
3. [LINE Developers コンソール](https://developers.line.biz/console/)で、そのプロバイダーの Messaging APIチャネルを開く
   - 「チャネル基本設定」のチャネルシークレットと、「Messaging API設定」のチャネルアクセストークン（長期・発行する）を控える
4. 同じプロバイダーに **LINEログインチャネル**を作る
   - 「チャネル基本設定」のチャネルIDを控える
   - LIFFタブでLIFFアプリを追加：サイズ `Full`、エンドポイントURL `https://<デプロイ先>.workers.dev/app`（デプロイ前は仮のURLでよい）、Scope `openid` と `profile`
   - 「LIFF ID」を控える
   - ※ プロバイダーが違うと同じ人でもuserIdが変わり、トークで記録したものがLIFF画面に出ません

### 2. レシート読み取りのAPIキー

[Google AI Studio](https://aistudio.google.com/) で Gemini API のキーを作る（無料枠）。無料枠では送った画像が Google の製品改善に使われることがあります（`docs/adr/0002-receipt-gemini.md`）。

### 3. Cloudflare側

```bash
npm install
npx wrangler login
npx wrangler d1 create kakeibo          # 出てきた database_id を wrangler.toml に貼る
npm run db:init                         # テーブル作成

npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GEMINI_API_KEY
```

`wrangler.toml` の `LIFF_ID` と `LOGIN_CHANNEL_ID` を書き換えてから：

```bash
npm run deploy
```

### 既存のDBを新しい版に合わせる

前の版から使っている DB には、`migrations/` の SQL を番号順に1回ずつ流してからデプロイします（流し済みのものは飛ばす）。新しく `npm run db:init` で作った DB には要りません。

```powershell
npx wrangler d1 execute kakeibo --remote --file=migrations/0001_shift_income.sql
npx wrangler d1 execute kakeibo --remote --file=migrations/0002_shift_one_calendar.sql
npx wrangler d1 execute kakeibo --remote --file=migrations/0003_payday_record.sql
npx wrangler d1 execute kakeibo --remote --file=migrations/0004_remind.sql
npx wrangler d1 execute kakeibo --remote --file=migrations/0005_subcategory.sql
npm run deploy
```

### 4. 接続

- Messaging APIチャネルの「Messaging API設定」で Webhook URL に `https://<デプロイ先>.workers.dev/webhook` を設定して「検証」し、「Webhookの利用」をオン
- LIFFのエンドポイントURLをデプロイ先に合わせる
- リッチメニュー（今月の集計 / グラフ・履歴 / 使い方）を設定：

```bash
LINE_CHANNEL_ACCESS_TOKEN=xxx LIFF_ID=yyy npm run richmenu
```

## シフト収入

バイトのシフトをひとつの Google カレンダーに入れておくと、時給・深夜手当・休憩・締め日・給料日から収入を計算します。家計簿の「設定」→「シフト収入を開く」、または `https://liff.line.me/<LIFF ID>/shift` で開きます。

- 予定のタイトルにバイト先の名前を書きます（例：「珈琲館 早番」）。名前以外の言葉で分けたいときは、バイト先の設定の「タイトルに含まれる言葉」に足します。どのバイト先にも当てはまらない予定は数えません
- 予定の説明欄に「休憩60」「休憩:30」と書くと、その回だけ休憩の分数を変えられます
- 終日の予定は数えません。祝日は [holidays-jp](https://holidays-jp.github.io/) から取ります
- トークで「収入」と送ると、今月の入金予定を返します
- 給料日の朝8時に「今日は◯◯の給料日です。見込み ◯円」と届きます。LINE の無料プランはこちらから送れる通数に月の上限（200通）があり、この通知もそれに数えます
- 給料日・仕送りの日の朝に、見込み額を家計簿に収入（給与・仕送り）として記録します。実際の金額と違うときは、通知の「金額を直す」を押してから数字だけ送るか、家計簿の履歴で直します。記録しないようにするには、シフト収入の設定でオフにします

### 使い始めるとき（1回だけ）

カレンダーの非公開URLは暗号化して保存します。その鍵を作って登録し、既存のDBにテーブルを足します。

```powershell
# 鍵を作る（表示された文字列を次のコマンドで貼る。ほかの人に見せない・どこにも保存しない）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put ICAL_ENCRYPTION_KEY
npm run deploy
```

既存のDBには、先に「既存のDBを新しい版に合わせる」の SQL を流しておきます。

鍵を作り直すと、登録済みのカレンダーURLが読めなくなります。そのときは設定画面でURLを貼り直してください。

### カレンダーのURL

パソコンの Google カレンダーで「設定」→ 左の一覧でシフトを入れたカレンダー →「カレンダーの統合」にある「iCal 形式の非公開アドレス」を、シフト収入の設定画面の「シフトのカレンダー」に貼ります。このURLを知っている人は誰でも予定を読めるので、ほかの人に見せたりコミットしたりしないでください。漏れたときは、同じ画面の「リセット」でURLを変えられます。

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # 中身を埋める
npm run db:init:local
npm run dev
npm test                          # 入力解析・日付・レシートJSONのテスト
RECEIPT_IMAGE=./receipt.jpg npm run try:receipt   # 本物のGemini APIでレシート画像を読む（.dev.vars の GEMINI_API_KEY を使う）
```

## 構成

```
src/
  index.ts    ルーティング（/webhook, /app, /api/*）
  bot.ts      LINEイベント処理（テキスト・画像・ポストバック）
  parse.ts    「ランチ 800」の解析、日付指定、初期カテゴリ
  receipt.ts  レシート画像 → Gemini API → JSON
  db.ts       D1 アクセス（記録・カテゴリ・予算・集計）
  api.ts      LIFF画面用API（IDトークンで本人確認）
  line.ts     署名検証・返信・画像取得・クイックリプライ
  app.html    LIFF画面（Chart.js）
  shift.html  シフト収入のLIFF画面
  shift/      シフト収入（計算・iCal読み込み・URLの暗号化・祝日・API）
migrations/ 既存DB向けの移行SQL
schema.sql    テーブル定義
scripts/      リッチメニュー作成スクリプトと画像
```

## 次にやること（v0.2 候補）

- LINEグループでの共有家計簿・割り勘精算（均等割り・傾斜割り）
- 買い物メモ（チェックリスト共有）
- PayPay取引履歴CSVの取り込み
