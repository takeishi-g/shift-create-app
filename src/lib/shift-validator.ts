import type { ShiftCode, ShiftGrid } from './shift-solver'
import type { StaffPairConstraint, StaffProfile } from '@/types'
import { pairTargetsNight, pairTargetsDay } from './shift-solver-csp'

// '明'（夜勤明け）は翌日の勤務扱いとして連続勤務カウントに含める
function isWork(code: string): boolean {
  return code === '日' || code === '夜' || code === '明'
}

function canTakeNight(
  grid: ShiftGrid,
  staffId: string,
  dayIdx: number,
  daysInMonth: number,
  maxConsecutive: number,
): boolean {
  if (grid[staffId][dayIdx] !== '') return false
  if (dayIdx > 0 && (grid[staffId][dayIdx - 1] === '夜' || grid[staffId][dayIdx - 1] === '明')) return false
  if (dayIdx + 1 < daysInMonth && grid[staffId][dayIdx + 1] !== '') return false
  if (dayIdx + 2 < daysInMonth && grid[staffId][dayIdx + 2] !== '') return false

  let streak = 1
  for (let i = dayIdx - 1; i >= 0; i--) {
    if (isWork(grid[staffId][i])) streak += 1
    else break
  }
  return streak <= maxConsecutive
}

function canTakeDay(
  grid: ShiftGrid,
  staffId: string,
  dayIdx: number,
  daysInMonth: number,
  maxConsecutive: number,
): boolean {
  if (grid[staffId][dayIdx] !== '') return false
  if (dayIdx > 0 && (grid[staffId][dayIdx - 1] === '夜' || grid[staffId][dayIdx - 1] === '明')) return false
  if (dayIdx + 1 < daysInMonth && grid[staffId][dayIdx + 1] === '夜') return false

  let before = 0
  for (let i = dayIdx - 1; i >= 0; i--) {
    if (isWork(grid[staffId][i])) before += 1
    else break
  }
  let after = 0
  for (let i = dayIdx + 1; i < daysInMonth; i++) {
    if (isWork(grid[staffId][i])) after += 1
    else break
  }
  return before + 1 + after <= maxConsecutive
}

function hasNightPairConflict(
  candidateId: string,
  pairConstraints: StaffPairConstraint[],
  assignedIds: Set<string>,
): boolean {
  return pairConstraints.some((pair) => {
    if (pair.constraint_type !== 'must_not_pair' || !pairTargetsNight(pair)) return false
    const partnerId =
      pair.staff_id_a === candidateId ? pair.staff_id_b
      : pair.staff_id_b === candidateId ? pair.staff_id_a
      : null
    return partnerId !== null && assignedIds.has(partnerId)
  })
}

function hasDayPairConflict(
  candidateId: string,
  pairConstraints: StaffPairConstraint[],
  assignedIds: Set<string>,
): boolean {
  return pairConstraints.some((pair) => {
    if (pair.constraint_type !== 'must_not_pair' || !pairTargetsDay(pair)) return false
    const partnerId =
      pair.staff_id_a === candidateId ? pair.staff_id_b
      : pair.staff_id_b === candidateId ? pair.staff_id_a
      : null
    return partnerId !== null && assignedIds.has(partnerId)
  })
}

/**
 * must_not_pair 制約違反をグリッドから検出・修正する後処理バリデーター。
 *
 * CSP/フォールバック後に呼び出す。複数ペア制約が存在するとき修正が相互に影響する可能性があるため、
 * 違反がなくなるか MAX_PASSES に達するまでスキャンを繰り返す（収束ループ）。
 *
 * 各違反に対して:
 *   1. staff_id_b のシフトを解放（夜勤なら '明'・'公' も解放）
 *   2. 代替スタッフを探して再充填（連続勤務チェック込み）
 *   3. 代替不能なら警告のみ（空きスロットのまま）
 *
 * '公' への強制変更は行わない。
 */
export function validateAndFixPairConstraints(
  grid: ShiftGrid,
  pairConstraints: StaffPairConstraint[],
  staff: StaffProfile[],
  warnings: string[],
  maxConsecutive = 5,
): void {
  if (staff.length === 0) return
  const daysInMonth = grid[staff[0].id]?.length ?? 0
  if (daysInMonth === 0) return

  const staffById = new Map(staff.map((s) => [s.id, s]))
  const mustNotPairs = pairConstraints.filter((p) => p.constraint_type === 'must_not_pair')
  if (mustNotPairs.length === 0) return

  // 複数ペア制約が相互に影響するため収束ループで繰り返す
  const MAX_PASSES = mustNotPairs.length + 1

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let anyFixed = false

    for (const pair of mustNotPairs) {
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        const aShift = grid[pair.staff_id_a]?.[dayIdx]
        const bShift = grid[pair.staff_id_b]?.[dayIdx]

        // スタッフ不在（undefined）・未割当（''）のいずれも違反対象外としてスキップ
        if (aShift === undefined || aShift === '' || bShift === undefined || bShift === '') continue

        const nightViolation = pairTargetsNight(pair) && aShift === '夜' && bShift === '夜'
        const dayViolation = pairTargetsDay(pair) && aShift === '日' && bShift === '日'
        if (!nightViolation && !dayViolation) continue

        const violationCode: '夜' | '日' = nightViolation ? '夜' : '日'
        const bName = staffById.get(pair.staff_id_b)?.name ?? pair.staff_id_b

        // 解放: staff_id_b のシフトを未割当に戻す
        grid[pair.staff_id_b][dayIdx] = ''
        if (violationCode === '夜') {
          // '明' は夜勤由来で確実に自動挿入されたもの
          if (dayIdx + 1 < daysInMonth && grid[pair.staff_id_b][dayIdx + 1] === '明') {
            grid[pair.staff_id_b][dayIdx + 1] = ''
          }
          // '公' は夜勤後の自動挿入が疑われる場合のみ解放
          // 他の理由（定休・手動）で入っている '公' と区別できないため、
          // === '公' の場合のみ解放する（誤解放リスクは設計上の限界として許容）
          if (dayIdx + 2 < daysInMonth && grid[pair.staff_id_b][dayIdx + 2] === '公') {
            grid[pair.staff_id_b][dayIdx + 2] = ''
          }
        }

        // 再充填: staff_id_a/b 以外で条件を満たすスタッフを探す
        // assignedOnDay は解放後の最新グリッド状態から構築する
        const assignedOnDay = new Set(
          staff
            .filter((m) => m.id !== pair.staff_id_a && m.id !== pair.staff_id_b && grid[m.id]?.[dayIdx] === violationCode)
            .map((m) => m.id),
        )
        // staff_id_a は違反の保持側として含める（候補のペア制約チェック用）
        assignedOnDay.add(pair.staff_id_a)

        const replacement = staff
          .filter((m) => m.id !== pair.staff_id_a && m.id !== pair.staff_id_b)
          .find((m) => {
            if (violationCode === '夜') {
              return (
                canTakeNight(grid, m.id, dayIdx, daysInMonth, maxConsecutive) &&
                !hasNightPairConflict(m.id, pairConstraints, assignedOnDay)
              )
            }
            return (
              canTakeDay(grid, m.id, dayIdx, daysInMonth, maxConsecutive) &&
              !hasDayPairConflict(m.id, pairConstraints, assignedOnDay)
            )
          })

        if (replacement) {
          grid[replacement.id][dayIdx] = violationCode as ShiftCode
          if (violationCode === '夜') {
            if (dayIdx + 1 < daysInMonth) grid[replacement.id][dayIdx + 1] = '明'
            if (dayIdx + 2 < daysInMonth && grid[replacement.id][dayIdx + 2] === '') grid[replacement.id][dayIdx + 2] = '公'
          }
          const rName = staffById.get(replacement.id)?.name ?? replacement.id
          warnings.push(`ペア制約後処理: ${dayIdx + 1}日 ${bName} を解放し ${rName} へ再充填しました`)
        } else {
          warnings.push(`ペア制約後処理: ${dayIdx + 1}日 ${bName} を解放しましたが代替スタッフが見つかりませんでした`)
        }

        anyFixed = true
      }
    }

    if (!anyFixed) break
  }
}
