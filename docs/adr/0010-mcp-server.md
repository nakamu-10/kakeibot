# 0010 外の AI から家計簿を使う MCP サーバーを、LINE ログインの OAuth で作る

- 日付：2026-11-28
- 背景：LINE での記録はそのままに、ふだん使っている AI（Claude・Gemini・Muse）からも家計簿を「つける・調べる・考える・良くする」ことをしたい（Issue #10）
- 決定：
  - リモート MCP サーバー（Streamable HTTP、`/mcp`）を、ボットとは別の Worker（`mcp/`、`kakeibot-mcp`）として作る。D1 はボットと同じものを使う
  - `@cloudflare/workers-oauth-provider` の `OAuthProvider` で、1つの Worker が OAuth の認証サーバーと MCP サーバーを兼ねる。MCP の処理は `agents` の `createMcpHandler`（状態を持たない）
  - 本人確認は LINE ログイン。LIFF と同じチャネルを使い、トークで記録した人と同じ userId にする。AI アプリごとの許可の画面を出してから LINE に進み、LINE とは PKCE でやり取りする
  - Claude は CIMD、Gemini・Muse は DCR でつなぐので、両方を有効にする
  - スコープは読み取り（`kakeibo:read`）から始め、書き込みはフェーズ2で `kakeibo:write` を足す。予算・カテゴリ・シフト収入の設定は AI に変えさせない
- 理由：
  - Issue の計画では認証サーバーと MCP サーバーを別の Worker にしていたが、ライブラリは1つの Worker で両方を兼ねる形も正式に支えている。AI の入口は1つだけなので、Service Binding と2つ目のデプロイがない方が簡単
  - ボットの Worker と分けると、ボットのデプロイと MCP サーバーのデプロイが互いに影響しない
  - 秘密の URL だけで本人確認する方法も考えたが、友だちそれぞれが自分の家計簿をつなげるようにしたいので OAuth にした
- 代替案：
  - ボットの Worker に `/mcp` を足す：Worker が1つで済むが、OAuth の KV や設定がボットに入り込み、ボットの変更と MCP の変更が混ざる
  - 秘密の URL：作るのは早いが、URL を知る人は誰でも読み書きでき、1人でしか使えない
- 注意：
  - LINE ログインチャネルが「開発中」の間は、管理者とテスターしかログインできない
  - Gemini アプリの「カスタムアプリ」は、紹介記事では米国の一部のアカウントだけとされている。Muse の一般向けアプリにカスタムコネクタがあるかも、記事どうしで食い違う
