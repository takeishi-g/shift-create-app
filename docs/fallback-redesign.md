# shift-solver-fallback.ts ゼロベース再設計案 v2

## 「公+公」の定義（確定）

**同じ日に師長と主任が両方とも `公`（または 明、有、希休、他 等の非勤務コード）になり、その日の日勤シニアカバレッジがゼロになる状態。**

---

## 問題の根本原因

```
現行の順序（バグあり）:
Pass1: 夜勤割り当て  ← 師長 A を D-2 に夜勤。D は強制公。
                        「主任 B はカバー可能」と判断（B[D] === ''）
Pass2: 定休日・休暇確定  ← B[D] が hard 定休日で '公' に確定！
Pass3: 日勤割り当て  ← A[D]=公(locked), B[D]=公(hard) → どちらも書き換え不可
       シニア先行確保も canAssignOpenDayShift(=== '') で false → 失敗
結果: D 日に師長・主任が両方 公 → 公+公 残存
```

**Pass 1 のシニアカバレッジ先読みが、まだ未確定の Pass 2 のハード制約を見ていない。**

---

## 新設計: ハード制約先行・確定順割り当て

```
Step A: 全ハード制約を先に確定
  A-1: 前月持ち越し（明・公）
  A-2: 有給・希望休・特別休暇
  A-3: 定休日・祝日（hard のみ）
  → frozenCells に全追加

Step B: 夜勤割り当て
  - 候補フィルタは確定済みグリッドを参照（`''` のみ夜勤可能）
  - dayIdx+1, dayIdx+2 の書き込み先も `''` のみ許可（Step A の '公'/'有'/'希休' は上書き禁止）
  - シニア先読み: 別シニアの dayIdx, dayIdx+1, dayIdx+2 が
    `''` かつ連勤超えず かつ must_not_pair 違反しないことを確認
  - 不可能なら夜勤拒否（警告のみ）
  - 割り当てた夜/明/公 は frozenCells に追加

Step C: シニア日勤を優先確保
  - 各日についてシニアが '日' でなければ、
    `''` のシニア候補を1名 '日' に確定
  - 候補がない場合（両者 frozenCells で詰み）→ 警告
  - 週末上限（maxWeekend）も考慮

Step D: 一般日勤で最低人数を充足
  - 残りの空きセルから minDay/minWeekend を満たすまで '日' 割り当て
  - 残った '' は '公' に確定（frozenCells には入れない）

Step E: 休日数調整
  - frozenCells の '公' は変換禁止
  - シニアの場合、その日に他シニアが '日' でなければ変換禁止
```

---

## Step A の優先順位（重複時の解決）

優先度: **前月持ち越し > 有給・希望休 > 定休日**

```
A-1 で day0 = '明'（前月持ち越し）が書かれた場合、
A-2 でユーザーが day0 に '希望休' を申請していたら → 警告して無視
A-3 で day0 が hard 定休日に該当しても → '明' のまま維持
```

---

## Step B の候補フィルタ（修正版）

```typescript
const candidates = nightCapable.filter((m) => {
  // 自セル
  if (grid[m.id][dayIdx] !== '') return false
  if ((nightCount.get(m.id) ?? 0) >= m.max_night_shifts) return false
  
  // 前日制約
  if (dayIdx > 0 && (grid[m.id][dayIdx - 1] === '夜' || grid[m.id][dayIdx - 1] === '明')) return false
  if (dayIdx > 1 && grid[m.id][dayIdx - 2] === '夜') return false
  if (countConsecutive(grid, m.id, dayIdx - 1) >= maxConsecutive) return false
  
  // 翌日・翌々日が空き or 既に夜勤セットでないこと
  // ※ 有/希休/他 等の確定セルがあれば夜勤不可
  if (dayIdx + 1 < daysInMonth && grid[m.id][dayIdx + 1] !== '') return false
  if (dayIdx + 2 < daysInMonth && grid[m.id][dayIdx + 2] !== '') return false
  
  // シニア先読み
  if (isSeniorRole(m.role)) {
    for (const offset of [0, 1, 2]) {
      const d = dayIdx + offset
      if (d >= daysInMonth) continue
      const otherCanCover = seniorStaff.some((senior) => {
        if (senior.id === m.id) return false
        if (grid[senior.id][d] !== '') return false  // Step A 確定済みなら不可
        if (countConsecutive(grid, senior.id, d - 1) >= maxConsecutive) return false
        if (hasDayMustNotPairOnDay(pairConstraints, grid, senior.id, d)) return false
        return true
      })
      if (!otherCanCover) return false
    }
  }
  
  return true
})
```

**重要な変更点**:
- `dayIdx+1`, `dayIdx+2` を「`''` のみ」に厳格化（Step A 確定セルへの上書きを防止）
- シニア先読みを `dayIdx`, `dayIdx+1`, `dayIdx+2` の3日分に統一
- 先読みで `must_not_pair` も確認

---

## Step C のシニア候補選択（負荷分散）

複数のシニア候補がいる場合、以下の優先順位で選ぶ:

```typescript
const seniorCandidates = seniorStaff
  .filter((m) => canAssignOpenDayShift(pairConstraints, grid, m.id, dayIdx, maxConsecutive))
  .sort((a, b) => {
    // 1. 連勤数が短い順
    const consA = countConsecutive(grid, a.id, dayIdx - 1)
    const consB = countConsecutive(grid, b.id, dayIdx - 1)
    if (consA !== consB) return consA - consB
    // 2. 既に割り当てた日勤数が少ない順
    const dayA = grid[a.id].filter((c) => c === '日').length
    const dayB = grid[b.id].filter((c) => c === '日').length
    return dayA - dayB
  })
```

---

## frozenCells の3層構造

| 由来 | frozenCells に入れる？ | Step E で変換可能？ |
|---|---|---|
| Step A-1 前月持ち越し（明・公） | ✅ Yes | ❌ No |
| Step A-2 有給・希望休・他 | ✅ Yes | ❌ No |
| Step A-3 定休日（hard） | ✅ Yes | ❌ No |
| Step B 夜勤セット（夜・明・公） | ✅ Yes | ❌ No |
| Step C シニア先行確保（日） | ❌ No | ⚠️ シニア視点でガード |
| Step D 一般日勤（日） | ❌ No | ⚠️ 最低人数でガード |
| Step D leftover（公） | ❌ No | ✅ Yes |

---

## 詰み検出（impossible scenario）

以下を検出して `warnings` に出力:

1. **両シニアが同日に hard 定休日**（A-3 完了後に判定）
   ```
   if (両師長主任の grid[id][D] === '公' && 両者が hard 定休日) {
     warnings.push(`${D+1}日: 両シニアがhard定休日のためカバー不可（要設定見直し）`)
   }
   ```

2. **前月持ち越しと希望休の矛盾**（A-1→A-2 中に検出）

3. **Step B でシニア夜勤が割り当てられない日**

---

## 削除するもの

| 削除対象 | 理由 |
|---|---|
| `lockedOff` / `lockCell` / `isLocked` | `frozenCells` に統一 |
| `canSeniorCoverDay` | Step B 先読みで `=== ''` に統一 |
| 既存 Pass 4（後補正 公→日） | Step C で予防的に解決 |
| 既存 Pass 2（夜勤後の定休日適用） | Step A-3 に前倒し |

---

## 期待される改善

| 項目 | 現行 | 新設計 |
|---|---|---|
| 公+公（両シニア公） | 残存する | **構造的に発生しない**（Step B で先読み正確化） |
| Step B シニア夜勤拒否 | 楽観的に許可 | Step A 確定後の正確な判定 |
| Step E が壊す制約 | 明け翌日チェックのみ | frozenCells で全保護 |
| 詰み検出 | なし | hard 制約矛盾を警告 |

---

## 変更対象ファイル

- `src/lib/shift-solver-fallback.ts`（全面書き直し）

---

## テストすべきシナリオ

1. **シニアA: 月火 hard 定休、シニアB: 水木 hard 定休** → 月火は B のみ、水木は A のみで日勤確保
2. **両シニア同日 hard 定休** → 警告出力
3. **シニアA: 夜勤翌日が シニアB: 希望休** → A の夜勤拒否
4. **前月末がシニア夜勤、当月1日に希望休** → 警告
5. **シニア複数で夜勤数が偏る** → Step C 負荷分散で平準化
