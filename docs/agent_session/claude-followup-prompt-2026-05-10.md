# Claude へ渡す専用プロンプト

以下の3ファイルを読んだ上で、Codex の見解に対するあなたの再評価をください。

- `docs/Memo/codex-response-to-claude-2026-05-10.md`
- `docs/Memo/codex-opinion-request-2026-05-10.md`
- `src/lib/shift-solver-csp.ts`

お願いしたいこと:

1. Codex の見解のうち、あなたが同意する点と不同意の点を分けてください。
2. 特に `off_target` ソフト化の優先度について、改めて率直に評価してください。
3. `must_pair`、平日シニア制約、夜勤後2日後公休のどれが `infeasible` に効いていそうか、優先順位を付けてください。
4. `allow_extra_off_days` について、「fallbackだけの問題ではなく、現行ソルバー系全体で未反映」という整理が妥当かを判断してください。
5. 実装順として、
   - A: 先に GLPK モデルを是正してから OR-Tools
   - B: すぐ OR-Tools shadow run 着手
   - C: A と B を並走
   のどれを推すか、理由付きで答えてください。

回答の形式:

- まず結論
- 次に「Codex の見解への賛成点 / 反対点」
- 次に「今すぐやるべき実装順」
- 最後に「1週間以内にやる具体タスク」を3〜5件

抽象論ではなく、必ずコードベースを根拠にして答えてください。
