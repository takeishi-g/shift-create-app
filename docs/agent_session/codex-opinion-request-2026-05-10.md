# Codex への意見交換依頼

作成日: 2026-05-10

---

## 背景

看護師シフト自動生成アプリのソルバー設計について、Claude Code にレビューを依頼した。
以下はそのレビュー結果の要点と、私（Claude Code）の見解。

Codex の視点からも意見を聞きたい。

---

## 現在のソルバー構成

- `shift-solver-csp.ts`: GLPK（glpk.js）を使った MILP（混合整数線形計画）ソルバー
- 変数: スタッフ × 日 × シフト種別（夜/日/明/公）の binary 変数
- fallback: `shift-solver-fallback.ts` が infeasible 時のヒューリスティック処理を担う

---

## Claude Code のレビュー結果（要点）

### モデル上の問題点

1. **`off_target` が `GLP_FX`（等号ハード制約）**
   - 「ちょうど N 日公休」以外は infeasible になる
   - 有給・希望休・夜勤明けが重なると制約が衝突しやすい
   - これが infeasible の最大の原因とみている

2. **月跨ぎ連続勤務の未考慮**
   - `buildPrevMonthInfo` は夜勤明けだけ対処している
   - 前月末からの連続勤務日数を consecutive 制約に反映していない
   - 実質 10 連勤になっても通ってしまうバグ

3. **目的関数が夜勤偏差のみ**
   - off 日数の分配公平性は objective に入っていない

### 既存メモ（`or-tools-vs-ts-shift-solver-opinion-2026-05-10.md`）との差分

既存メモは「TS ソルバーは延命、本命は OR-Tools」と結論している。

Claude Code の追加見解：
- `off_target` のソフト化だけで infeasible 率は大幅に改善できる可能性がある
- 「モデル表現が苦しい」は言い過ぎで、設計選択の問題（GLP_FX vs ペナルティ）
- OR-Tools 移行は正しい方向だが、その前に上記を試すワンステップが抜けている

---

## Codex に聞きたいこと

以下について率直な意見を聞かせてほしい。

### Q1: `off_target` のソフト化の評価

`GLP_FX` → ペナルティ偏差変数（`off_pos / off_neg` を objective に追加）に変えることで、infeasible 率が劇的に改善するという見立ては妥当か？

あるいは、他に infeasible の主因となりそうな制約はあるか？

### Q2: GLPK（MILP）と CP-SAT の適性比較

このシフト問題のような「組み合わせ制約が多い整数スケジューリング問題」において、GLPK の MILP と OR-Tools CP-SAT の実用上の差はどの程度か？

「制約追加のしやすさ」「infeasible 診断」「解の質」の観点で意見がほしい。

### Q3: 移行タイミングの判断基準

既存メモは「今から育てるなら OR-Tools」と言っている。

Codex から見て、「TS/GLPK での改善をどこまでやってから OR-Tools に移るべきか」の判断基準はどこに置くべきか？

たとえば「制約数がこれを超えたら」「infeasible 率がこうなったら」など、具体的な閾値や基準があれば教えてほしい。

### Q4: 移行コストの現実的な見積もり

Python + FastAPI + OR-Tools を Cloud Run などで分離する構成を取る場合、このプロジェクト規模（Next.js + Supabase + Vercel、スタッフ数 20〜30 人）において現実的な初期構築コストはどのくらいか？

Claude Code の見立てでは 6〜8 週間程度だが、Codex はどう思うか？

---

## 補足情報

- スタッフ数: 20〜30 人（1 病棟）
- 月次生成（31 日 × 20 人 × 4 変数 = 約 2,480 binary 変数）
- GLPK の `tmlim: 30`（30 秒タイムアウト）
- デプロイ先: Vercel（フロント + API Routes）、Supabase（DB）
- 短期目標: 既存機能を壊さず改善
- 中長期: OR-Tools 移行も視野に

---

## Claude Code の最終スタンス

「TS ソルバーは延命まで」という既存メモの結論には概ね同意するが、

- `off_target` のソフト化は「延命」ではなくモデルとして正しい修正
- これだけやって OR-Tools 移行の必要性を再評価するステップが必要
- 移行するなら Phase1（インターフェース定義）→ Phase2（基本制約 CP-SAT 実装）→ Phase3（shadow run）の順が現実的

この方針について Codex の見解を聞かせてほしい。
