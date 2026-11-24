# LINE家計簿ボット

LINEに「ランチ 800」と送るだけで記録できる家計簿ボット。レシートの写真を送るとAI（Claude）が読み取ります。
Cloudflare Workers + D1 で動き、グラフ・履歴・設定はLIFF画面（LINE内で開くWebページ）で見ます。

## できること（v0.1）

| 機能 | 内容 |
|---|---|
| テキスト入力 | 「ランチ 800」「スーパー 2,480」「800 ランチ」「食費 800」「趣味 ガンプラ 3000」 |
| 収入 | 「+給料 50000」「収入 バイト 30000」「バイト代 42000」 |
| 日付指定 | 「昨日 ランチ 800」「おととい …」「11/20 本 1200」 |
| レシート読取 | 写真を送るとAIが店名・合計・日付・カテゴリを判定して記録 |
| 記録後の操作 | クイックリプライで「取り消す」「カテゴリ変更」「今月」「レシート撮影」「グラフ」 |
| コマンド | 今月 / 先月 / 予算 50000 / 予算 / 取り消し / カテゴリ / グラフ / ヘルプ |
| LIFF画面 | 月の収支・予算残り、日別グラフ、カテゴリ別グラフ、6か月推移、月比較、履歴の追加・編集・削除、予算設定、カテゴリ追加・編集・並び替え・削除、CSV書き出し |

カテゴリの自動判定はカテゴリごとの「キーワード」で行います（例：食費 ← ランチ, コンビニ, スタバ…）。設定画面から自由に編集できます。

## セットアップ

### 1. LINE側の準備（LINE Developers）
1. プロバイダーを作り、**Messaging APIチャネル**を作成
   - 「チャネルシークレット」と「チャネルアクセストークン（長期）」を控える
   - LINE Official Account Manager で「応答メッセージ」をオフ、「Webhook」をオン
2. 同じプロバイダーに **LINEログインチャネル**を作成
   - 「チャネルID」を控える
   - LIFFタブでLIFFアプリを追加：サイズ `Full`、エンドポイントURL `https://<デプロイ先>.workers.dev/app`、Scope `openid` と `profile`
   - 「LIFF ID」を控える
   - ※ LIFFとMessaging APIを同じプロバイダーにしないとuserIdが一致しません

### 2. Cloudflare側
```bash
npm install
npx wrangler login
npx wrangler d1 create kakeibo          # 出てきた database_id を wrangler.toml に貼る
npm run db:init                         # テーブル作成

npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
```
`wrangler.toml` の `LIFF_ID` と `LOGIN_CHANNEL_ID` を書き換えてから：
```bash
npm run deploy
```

### 3. 接続
- Messaging APIチャネルの Webhook URL に `https://<デプロイ先>.workers.dev/webhook` を設定して「検証」
- LIFFのエンドポイントURLをデプロイ先に合わせる
- リッチメニュー（今月の集計 / グラフ・履歴 / 使い方）を設定：
```bash
LINE_CHANNEL_ACCESS_TOKEN=xxx LIFF_ID=yyy npm run richmenu
```

## ローカル開発
```bash
cp .dev.vars.example .dev.vars   # 中身を埋める
npm run db:init:local
npm run dev
npm test                          # 入力解析・日付・レシートJSONのテスト
```

## 構成
```
src/
  index.ts    ルーティング（/webhook, /app, /api/*）
  bot.ts      LINEイベント処理（テキスト・画像・ポストバック）
  parse.ts    「ランチ 800」の解析、日付指定、初期カテゴリ
  receipt.ts  レシート画像 → Claude API → JSON
  db.ts       D1 アクセス（記録・カテゴリ・予算・集計）
  api.ts      LIFF画面用API（IDトークンで本人確認）
  line.ts     署名検証・返信・画像取得・クイックリプライ
  app.html    LIFF画面（Chart.js）
schema.sql    テーブル定義
scripts/      リッチメニュー作成スクリプトと画像
```

## 次にやること（v0.2 候補）
- LINEグループでの共有家計簿・割り勘精算（均等割り・傾斜割り）
- 買い物メモ（チェックリスト共有）
- PayPay取引履歴CSVの取り込み
- 記録忘れ通知（Cron Triggers で夜に未記録の人へプッシュ）
