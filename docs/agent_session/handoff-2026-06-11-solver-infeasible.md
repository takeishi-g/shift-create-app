# セッション引き継ぎ: シフト生成の解なし問題調査（2026-06-11）

> 前セッション（claude/shift-constraints-consistency-lnayal ブランチ）からの引き継ぎ文書。
> 7月シフト生成が CSP 解なし→フォールバック出力になる問題の調査結果と残タスクをまとめる。

## このセッションで完了したこと

1. **シフト表mdとCONSTRAINTS.mdの整合性調査**
   - `docs/shift-2026-05.md` はDBと完全一致（465/465セル）
   - `docs/shift-2026-06.md` はDBと337/450セル不一致の壊れたデータだった → DBの正データで再生成し PR #86 を作成
   - 6月の確定シフト（手動修正済み）はCONSTRAINTS.mdをほぼ遵守していることを確認
2. **「設定変更が生成結果に反映されない」問題の1次調査**
   - 7/1開院記念日が平日扱い → シニアペア制約が充足不能 → CSP全体が解なし → 常にフォールバック、という構造を特定
   - Issue #87（カスタム休日対応）を作成 → 別セッションで実装済み（PR #88、マージ済み）
3. **Issue #87実装後も解なしが続く問題の根本原因特定（本セッションのメイン成果）**
   - origin/main のソルバーをローカル実行し、本番同等入力（DBから取得）で infeasible を再現
   - 制約行を選択的に無効化するデバッグフックで総当たり→貪欲法最小化→個別ドリルダウン
   - **下記4件の独立した矛盾を特定。4件すべて除去すると success になることを実証済み**

## 特定済みの根本原因（4件）— 未修正

### 1. 風呂日最低人数が休日にも適用される（コードバグ・最重要）
- 7/1（水）は風呂日（水木・最低7人）と休日（カスタム休日・日勤max3人）が重なり、**min 7 > max 3 の矛盾制約ペア**が生成される
- 該当: `src/lib/shift-solver-csp.ts` の `getShiftMinimums` → `requiredDayByIndex`（`isBathDay` の `Math.max` が `isWeekend` でも適用される）
- 修正方針: 土日祝・カスタム休日には風呂日最低人数を適用しない。加えて「min>max になる日」の事前検出を `checkFeasibility` に追加するとよい
- フォールバック側 `getDayRequirements`（shift-solver-fallback.ts）にも同じロジックがあるので併せて確認

### 2. 森さん「7/1 シフト希望:夜勤」が月跨ぎ強制公休と矛盾（データ）
- 森さんは6/29夜・6/30明 → 月跨ぎ処理で7/1=公がGLP_FX固定。一方シフト希望で n=1 もFX固定 → onehot違反
- 対処: leave_requests から森さんの7/1夜勤希望を削除（運用）。恒久対応はプリフライト検証

### 3. 山下さん・藤田さんが両方「7/2 シフト希望:夜勤」（データ）
- 2人は must_not_pair（同日夜勤禁止）。希望2件とも FX 固定のため矛盾
- 対処: どちらかの希望を削除（運用）。恒久対応はプリフライト検証

### 4. 西谷さんの夜勤希望 7/15・7/24 が夜勤分散ルールと矛盾
- 夜勤上限2回のスタッフには `night_spacing` で最小間隔 max(3, floor(31/2)-1)=14日 が課されるが、希望は9日間隔
- 対処: 希望の一方を削除 or 夜勤上限を3に（運用）。設計的には「シフト希望がある場合は spacing をソフト化/除外」も検討

## その他の既知バグ（未修正・このセッションで発見）

- **`src/app/api/shift/generate/route.ts:87`**: `staff_carry_overs`（複数形）を参照。実テーブルは `staff_carry_over` → **生成時に公休繰越が常に無視される**（エラー未チェックで無音）
- **`src/app/(app)/constraints/page.tsx` 保存処理**: `update` のエラー未チェック。保存失敗しても「保存しました」と表示され得る
- **フォールバック（shift-solver-fallback.ts）**: 夜勤候補リストのフィルタ（must_not_pair等）が構築時の1回のみで、同日内の割当後に再チェックされない／夜勤後公休スロットが埋まっていると警告のみで放置（明明・夜明日勤などのパターン破壊の原因）
- infeasible時のユーザー向けメッセージが汎用文のみで、原因（誰のどの希望が矛盾か）が分からない → プリフライト検証の実装を推奨

## 検証手順の再現方法（必要になったら）

1. `git worktree add /tmp/wt origin/main --detach && cd /tmp/wt && npm install`（node_modules共有不可のため都度install）
2. 本番入力をDBから組み立てる: staff_profiles / shift_constraints(year_month='2026-07') / leave_requests(7月) / staff_pair_constraints / shift_types / shift_assignments(6/29-30→prevMonthTail) / custom_holidays。`carryOverByStaff` は route のタイポバグ再現のため `{}`
3. vitest のテストファイルから `generateShifts`（shift-solver-csp.ts）を直接呼ぶ
4. 制約の切り分けは、メインパスの `addRow` に「`SKIP_ROWS` 環境変数のプレフィックスに一致する行名をスキップ」するフックを一時的に入れると効率的（行名例: `night_spacing__<staffId>__`, `must_not_pair_night__<idA>__<idB>__<day>`, `min_day__<dayIdx>`, `forced_off__<staffId>__<dayIdx>`）
- 注: 調査用スクリプト群は /tmp（揮発）にあったため消滅。上記手順で再構築可能

## 関連リンク・状態

- PR #86（6月mdをDB正データで再生成）: draft・未マージ。ブランチ: `claude/shift-constraints-consistency-lnayal`
- Issue #87（カスタム休日）: PR #88 で実装・マージ済み（クローズ確認は未実施）
- Notion knowledge: 「シフト自動生成が設定変更に反応しない問題の調査記録と教訓」（knowledge DB、2026-06-10作成。原因1〜4の発見前の内容なので、最新の結論は本ファイルが正）
- DB: Supabaseプロジェクト `Supabase-shift-create-app`（yvzlqddmwupuhprnztsh）
- 役職: 師長=武石さん・主任=前川さん。准看護師=森さん・山下さん（must_not_pairの背景）

## 推奨される次のアクション

1. 原因1のコード修正（風呂日×休日の優先順位）＋ min>max 事前検出
2. 原因2〜4のデータ整理（該当シフト希望の削除 or 調整）→ 7月再生成で CSP success を確認
3. プリフライト検証（矛盾の具体的な警告）の実装検討
4. `staff_carry_overs` タイポ修正（1行）

---

## 対応状況（2026-06-11 後続セッション・claude/solver-infeasible-handoff-2iu226 ブランチ）

### 実装済み

1. **原因1（風呂日×休日の min>max）— 修正済み**
   - `shift-solver-csp.ts` `getShiftMinimums`: 風呂日最低人数を平日のみ適用に変更
   - `shift-solver-fallback.ts` `getDayRequirements`: 同様の修正
   - `checkFeasibility` に日別の min>max 事前検出を追加（設定ミス全般を捕捉）
   - `docs/CONSTRAINTS.md` 6章に例外ルールを明記
2. **原因2・3（シフト希望の矛盾）— プリフライト検証を実装**
   - `checkFeasibility` に以下を追加。検出時は supply-error として赤帯でスタッフ名・日付入りのメッセージを表示（無言フォールバックを廃止）
     - シフト希望 × 月跨ぎ強制公休／強制明け／休暇申請／ハード定休日 の同日衝突
     - must_not_pair ペアの両者が同日に同種シフト希望
   - データ自体（森さん7/1・山下さん×藤田さん7/2）は未修正（運用判断待ち）
3. **原因4（西谷さんの夜勤希望×夜勤分散）— 修正済み**
   - `night_spacing` 制約は両端日とも夜勤シフト希望（GLP_FX固定）の場合スキップ（希望優先）。s1パス・メインパス両方
4. **`staff_carry_overs` タイポ — 修正済み**（`route.ts` → `staff_carry_over`）

### 検証結果（本番同等入力・DBから再構築）

- 現状データ: supply-error となり「森さん7/1の希望×強制公休」「山下さん×藤田さん7/2の夜勤希望×ペア制約」を正確に報告
- 上記2件の希望を除いた入力: **CSP success**。西谷さんの7/15・7/24夜勤希望は両方反映、7/1（カスタム休日×風呂日）の日勤は3人以下

### 残タスク

- leave_requests のデータ整理（運用判断）: 森さん7/1夜勤希望の削除、山下さん/藤田さんどちらかの7/2夜勤希望の削除 → アプリのプリフライトメッセージでも案内される
- 未着手の既知バグ: constraints ページ保存処理のエラー未チェック、フォールバックの夜勤候補再チェック
