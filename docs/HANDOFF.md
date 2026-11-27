# 引き継ぎメモ

人もAIも、作業の初めにこれを読み、終わりに更新する。決めたことは`docs/adr/`、急がないタスクや相談はGitHub Issuesに書き、ここには「今どこまで進んでいて、次に何をするか」だけを残す。

最終更新：2026-11-28

## 今の状態

### 本番（Cloudflare Workers + D1）

デプロイはユーザーが手で行う（`npm run deploy`・`npm run deploy:mcp`）。Claude は本番に触るコマンドを実行できない（`.claude/settings.json`）。

- ボット：`https://line-kakeibo-bot.kocchi.workers.dev`（LIFF は `/app` と `/app/shift`）
- MCP サーバー：`https://kakeibot-mcp.kocchi.workers.dev/mcp`
- 2026-11-28 にユーザーが確かめたこと
  - LIFF の新しい見た目（ADR 0009）が出ている
  - Claude のコネクタから LINE ログインでつながり、読み取りのツールで家計簿の数字が返る
- まだ確かめていないこと
  - MCP のフェーズ2（記録の追加・修正・削除、PR #15）が本番に出ているか
  - そのための移行 SQL `0006_edit_count.sql` を流したか
  - ユーザーが流したと言った移行 SQL は 0001〜0005。0006 は未確認

### コード

- main は PR #15（MCP のフェーズ2）まで入っている
- 割り勘の古いブランチ `feat/group-split` は手元にだけあり、今の main とかなりずれている

## 次にすること

1. Issue #10 のフェーズ3：要望を残す `send_feedback`（D1 にためる。公開リポジトリなので Issue には直接作らない）と、使い方から改善案 `get_usage_insights`
2. その次の候補（ユーザーと相談）
   - 変更履歴と取り消し（AI に予算の変更も許すなら、一緒に入れる）
   - 予算8割の警告・週のふりかえりの通知
3. 残っている大きな候補：グループでの割り勘、買い物メモ、PayPay の CSV 取り込み

## 作業のこつ

- LIFF の画面を変えたら、`node scripts/preview.mjs`（架空のデータ、ポート 8790）で開き、スマホの幅（390px）で撮って見比べる
  - Edge を `--window-size` だけで撮ると、幅が 500px より狭くならない。DevTools Protocol で端末をまねる
- MCP のツールは、ローカル D1（`getPlatformProxy`）と、SDK の `InMemoryTransport` で MCP クライアントから呼んで確かめる。HTTP 経由だと Node が Host ヘッダーを落とすので通らない
- `node_modules` の一部が pnpm の形になっていて、手元に `pnpm-lock.yaml` がある（ユーザーのもの。commit しない）。`@modelcontextprotocol/client` は `node_modules/.pnpm/...` からでないと読めない
- PR のマージは、ユーザーが「マージしていい」と言ったときだけ。Claude Code の権限の判定で止められたら、もう一度言ってもらうか、ユーザーが自分でマージする
