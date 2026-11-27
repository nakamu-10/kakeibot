# 0001 ガードレールを入れる

- 日付：2026-11-24
- 背景：Claude Codeにリモートで作業させる。人が毎回コードを読まなくても、壊れたものや秘密がmainに入らないようにしたい
- 決定：
  - CLAUDE.md に構成・ルール・してはいけないことを書く
  - `.claude/settings.json` で、force push・`--no-verify`・本番への操作（`wrangler deploy`、`wrangler secret`、`--remote` のD1操作）を禁止する。依存の追加とpushは確認を挟む
  - Prettier・ESLint（typescript-eslint の strictTypeChecked）・knip・lefthook（commit時に整形・lint・gitleaks）
  - GitHub Actions で整形・lint・knip・型・テスト・`wrangler deploy --dry-run`・gitleaks を並列に流す
- 理由：書いて伝える → AIのコマンドを止める → commitで止める → pushで止める、の4段で止めると、どこかで漏れても次で止まる。本番のLINEボットを壊さないよう、デプロイは人の手に残す
- 代替案：
  - PRの行数・テストの有無の警告、textlint、issueテンプレート：チームでレビューを回すための仕組みなので1人では後回し
  - ESLintの独自ルール：同じ設計違反をAIが繰り返すようになってから `no-restricted-imports` などで足す
  - ESLintの `restrict-template-expressions` は数値だけ許した（金額・日付の埋め込みが多いため）。`no-confusing-void-expression` は `return reply(...)` で抜ける書き方を許した

追記（2026-11-28）：引き継ぎ・ひとりでのレビュー・改行のそろえなどを 0011 で足した。
