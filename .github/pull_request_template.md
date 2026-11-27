## 何を変えたか

## なぜ

## どう確かめたか

- [ ] `npm run check` が通る（整形・lint・knip・型・テスト・2つの Worker のバンドル）
- [ ] ボット：`npm run dev` ＋ `node scripts/webhook.mjs` で DB への記録を確かめた
- [ ] LIFF 画面：`node scripts/preview.mjs` で、スマホの幅で見た
- [ ] MCP：ローカル D1 で MCP クライアントからツールを呼んだ
- [ ] LINE 実機・LIFF・AI アプリで確かめてほしい点：

## レビュー（CLAUDE.md の「レビュー」）

- [ ] CI が全部通った
- [ ] PR を作った会話の記憶を持たない Claude で `/code-review <PR番号> --comment` を実行し、指摘に答えた
- [ ] 差分全体を、他人が書いたつもりで読んだ
- [ ] 本番のデータ・鍵・認証・移行 SQL に関わるなら、一晩おいて読み直した

## 本番に出すとき（ユーザーが手でする）

- [ ] 移行 SQL あり：`npx wrangler d1 execute kakeibo --remote --file=migrations/<番号>.sql` を、デプロイより先に流す
- [ ] ボットのデプロイ：`npm run deploy`
- [ ] MCP サーバーのデプロイ：`npm run deploy:mcp`
- [ ] シークレット・LINE の設定（コールバック URL など）を変える
- [ ] `docs/HANDOFF.md` の「本番」を、確かめた日付つきで更新した
