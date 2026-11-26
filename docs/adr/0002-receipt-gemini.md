# 0002 レシート読み取りを Gemini API の無料枠にする

- 日付：2026-11-25
- 背景：v0.1 は Claude API（Haiku 5.5）で読み取っていた。1枚0.1円程度と安いが、従量課金なので Anthropic Console にクレジットを前払いする必要がある。まずは費用ゼロで動かしたい
- 決定：
  - Gemini API の無料枠で読み取る。モデルは `gemini-3.5-flash-lite` を先に試し、混雑・回数上限・時間切れなら `gemini-3.8-flash` で読む。`RECEIPT_MODEL`（カンマ区切り）で変えられる
  - 呼び方は Interactions API（`POST /v1beta/interactions`）。公式が新規開発に勧めている方。`generateContent` は「既存向けのレガシー」とされている
  - SDK は入れず `fetch` で呼ぶ。呼ぶのが1か所だけで、Workers で余計な依存を増やしたくない
  - `response_format` に JSON Schema を渡して JSON で返させる。null を避けるため、読めない日付は空文字で返させる
  - `store: false` にして、Google側に会話として保存させない
  - 思考は `thinking_level: "low"`。読み取りに深い推論はいらず、待ち時間を短くしたい
  - 429（回数の上限）は専用の返信にして、文字での記録を促す
- 理由：個人の家計簿なら無料枠の回数で足りる見込み。読み取り精度は Claude と大きくは変わらないと見ている
- 代替案：
  - Claude API のまま：送った内容が学習に使われず安心だが、少額でも課金の準備がいる
  - Gemini 有料枠：学習に使われないが、課金の準備がいるのは Claude と同じ
- 注意：無料枠では、送った画像と文章が Google の製品改善に使われ、人が見ることもある（料金ページの「Used to improve our products: Yes」）。気になるようになったら、有料枠か Claude に戻す。無料枠の回数上限は Google AI Studio で確かめる
