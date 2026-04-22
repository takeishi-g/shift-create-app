import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import { StaffProfile, LeaveRequest, ShiftConstraints, StaffPairConstraint } from '@/types'

export type ShiftCode = '日' | '夜' | '明' | '公' | '有' | '他' | '希休' | ''
export type ShiftGrid = Record<string, ShiftCode[]>

export interface SolverInput {
  yearMonth: string
  staff: StaffProfile[]
  constraints: ShiftConstraints | null
  leaveRequests: LeaveRequest[]
  pairConstraints: StaffPairConstraint[]
  bathDayIndices: number[]
  /** 前月末2日分のシフト（月跨ぎ夜勤の持ち越し用） */
  prevMonthTail?: { staff_id: string; shift_code: string; day: number }[]
}

export interface SolverOutput {
  grid: ShiftGrid
  warnings: string[]
  targetOffDays: number
}

const WORK_CODES: ShiftCode[] = ['日', '夜']

function isWork(code: ShiftCode): boolean {
  return WORK_CODES.includes(code)
}

function consecutiveWorkEndingAt(shifts: ShiftCode[], dayIdx: number): number {
  let count = 0
  for (let i = dayIdx; i >= 0; i--) {
    if (isWork(shifts[i])) count++
    else break
  }
  return count
}

function leaveTypeToCode(type: string): ShiftCode {
  switch (type) {
    case '希望休': return '希休'
    case '有給': return '有'
    case '特別休暇':
    case '他': return '他'
    default: return ''
  }
}

export function generateShifts(input: SolverInput): SolverOutput {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, bathDayIndices, prevMonthTail } = input
  const warnings: string[] = []

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))

  const minPerShift = (constraints?.min_staff_per_shift ?? {}) as Record<string, number>
  const minNight       = minPerShift['夜勤'] ?? 2
  const minDay         = minPerShift['日勤'] ?? 3
  const minBathDay     = constraints?.min_staff_bath_day ?? 3
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const targetOffDays  = (constraints as Record<string, unknown> | null)?.['target_off_days'] as number | undefined
    ?? Math.round(daysInMonth * 0.27)

  // 目標休日数の計算には明を含めない（明は夜勤の構造的付随物で表示上の休日ではない）
  const VISIBLE_OFF = new Set<ShiftCode>(['公', '有', '他', '希休'])
  const countVisibleOffs = (shifts: ShiftCode[]) => shifts.filter((c) => VISIBLE_OFF.has(c)).length

  const grid: ShiftGrid = {}
  staff.forEach((s) => { grid[s.id] = Array(daysInMonth).fill('') as ShiftCode[] })

  // ── Pass 0: 前月末夜勤の月跨ぎ持ち越し ───────────────────────────────────
  // 前月最終日が夜勤 → 当月1日=明け、2日=公休
  // 前月最終日が明け（前々日が夜勤）→ 当月1日=公休
  if (prevMonthTail) {
    const byStaff: Record<string, Record<number, string>> = {}
    prevMonthTail.forEach(({ staff_id, shift_code, day }) => {
      if (!byStaff[staff_id]) byStaff[staff_id] = {}
      byStaff[staff_id][day] = shift_code
    })
    Object.entries(byStaff).forEach(([staffId, days]) => {
      if (!grid[staffId]) return
      const lastDay = Math.max(...Object.keys(days).map(Number))
      const lastCode = days[lastDay]
      const prevCode = days[lastDay - 1]
      if (lastCode === '夜') {
        grid[staffId][0] = '明'
        if (daysInMonth > 1) grid[staffId][1] = '公'
      } else if (lastCode === '明' || prevCode === '夜') {
        grid[staffId][0] = '公'
      }
    })
  }

  // ── Pass 1: Fixed assignments from leave requests ────────────────────────
  leaveRequests.forEach((lr) => {
    const [ly, lm, ld] = lr.date.split('-').map(Number)
    if (ly !== year || lm !== month) return
    const dayIdx = ld - 1
    if (dayIdx < 0 || dayIdx >= daysInMonth || !grid[lr.staff_id]) return
    if (lr.type === 'シフト希望') {
      const preferred = (lr as unknown as { preferred_shift_type?: { name: string; is_overnight: boolean } }).preferred_shift_type
      if (preferred?.is_overnight) {
        grid[lr.staff_id][dayIdx] = '夜'
        if (dayIdx + 1 < daysInMonth) grid[lr.staff_id][dayIdx + 1] = '明'
      } else if (preferred) {
        grid[lr.staff_id][dayIdx] = '日'
      }
      return
    }
    const code = leaveTypeToCode(lr.type)
    if (code) grid[lr.staff_id][dayIdx] = code
  })

  // ── Pass 1.5: 強制休（定休曜日・祝日）を事前に '公' で確定 ─────────────
  // Pass 2（夜勤分散）よりも先に行うことで、定休日に夜勤が入るのを防ぐ
  staff.forEach((s) => {
    const offDow = new Set(s.off_days_of_week ?? [])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[s.id][dayIdx] !== '') continue
      const date = new Date(year, month - 1, dayIdx + 1)
      const dow = date.getDay()
      const isHoliday = HolidayJP.isHoliday(date)
      if (offDow.has(dow) || (s.off_on_holidays && isHoliday)) {
        grid[s.id][dayIdx] = '公'
      }
    }
  })

  // ── Pass 2: Night shift distribution (even spread) ──────────────────────
  // Pass 1 で確定済みの夜勤を nightCount に反映してからカウント開始
  const nightCount: Record<string, number> = {}
  staff.forEach((s) => { nightCount[s.id] = grid[s.id].filter((c) => c === '夜').length })

  function canAssignNight(shifts: ShiftCode[], dayIdx: number): boolean {
    if (shifts[dayIdx] !== '') return false
    // 直前が夜勤開始中（夜）なら不可（明けが入るべき位置）
    if (dayIdx > 0 && shifts[dayIdx - 1] === '夜') return false
    // 直前が明けの場合: 夜→明のパターンの続きのみ許可（2連続夜勤）
    if (dayIdx > 0 && shifts[dayIdx - 1] === '明') {
      if (dayIdx < 2 || shifts[dayIdx - 2] !== '夜') return false
    }
    // 翌日に明け以外が入っている場合は不可
    if (dayIdx + 1 < daysInMonth && shifts[dayIdx + 1] !== '' && shifts[dayIdx + 1] !== '明') return false
    // 連続勤務上限チェック
    if (consecutiveWorkEndingAt(shifts, dayIdx - 1) >= maxConsecutive) return false
    // 夜勤連続2回まで: 夜→明→夜→明→夜（3連続）を阻止
    if (dayIdx >= 4 &&
        shifts[dayIdx - 1] === '明' &&
        shifts[dayIdx - 2] === '夜' &&
        shifts[dayIdx - 3] === '明' &&
        shifts[dayIdx - 4] === '夜') return false
    return true
  }

  function assignNight(s: typeof staff[0], dayIdx: number) {
    grid[s.id][dayIdx] = '夜'
    nightCount[s.id]++
    if (dayIdx + 1 < daysInMonth) grid[s.id][dayIdx + 1] = '明'
    // 明けの翌日は Pass 2.5 で一括確定するため autoInsert はしない
  }

  // Day-by-day greedy: 毎日 minNight 人に達するまで補充
  //   - behindRatio = dayIdx/daysInMonth - nightCount/max で正規化（師長等も均等分散）
  //   - max_night_shifts 以内を優先、足りない日のみ max 超過で補充（警告付き）
  //   - max_night_shifts === 0 のスタッフは絶対に割り当てない（ハード制約）
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const currentNight = staff.filter((s) => grid[s.id][dayIdx] === '夜').length
    let needed = Math.max(0, minNight - currentNight)
    if (needed === 0) continue

    const eligibleStrict = staff
      .filter((s) =>
        s.max_night_shifts > 0 &&
        nightCount[s.id] < s.max_night_shifts &&
        canAssignNight(grid[s.id], dayIdx)
      )
      .sort((a, b) => {
        const behindA = dayIdx / daysInMonth - nightCount[a.id] / a.max_night_shifts
        const behindB = dayIdx / daysInMonth - nightCount[b.id] / b.max_night_shifts
        if (Math.abs(behindA - behindB) > 0.01) return behindB - behindA
        return countVisibleOffs(grid[a.id]) - countVisibleOffs(grid[b.id])
      })

    const toStrict = Math.min(needed, eligibleStrict.length)
    for (let i = 0; i < toStrict; i++) assignNight(eligibleStrict[i], dayIdx)
    needed -= toStrict

    if (needed > 0) {
      const eligibleRelaxed = staff
        .filter((s) => s.max_night_shifts > 0 && canAssignNight(grid[s.id], dayIdx))
        .sort((a, b) => (nightCount[a.id] - a.max_night_shifts) - (nightCount[b.id] - b.max_night_shifts))

      const toRelaxed = Math.min(needed, eligibleRelaxed.length)
      for (let i = 0; i < toRelaxed; i++) assignNight(eligibleRelaxed[i], dayIdx)
      needed -= toRelaxed

      if (toRelaxed > 0) {
        warnings.push(`${dayIdx + 1}日: 最大夜勤回数を超過して${toRelaxed}人補充しました`)
      }
    }

    if (needed > 0) {
      warnings.push(`${dayIdx + 1}日: 夜勤 最低${minNight}人に対し${minNight - needed}人しか確保できません`)
    }
  }

  // ── Pass 2.5: 明けの翌日を公休に確定（ハード制約）────────────────────────
  // 夜勤連続（夜→明→夜）の場合は翌日が既に夜なので上書きしない
  staff.forEach((s) => {
    for (let d = 0; d < daysInMonth - 1; d++) {
      if (grid[s.id][d] === '明' && grid[s.id][d + 1] === '') {
        grid[s.id][d + 1] = '公'
      }
    }
  })

  // ── Pass 3: Fill remaining with 日勤 or 公休 ────────────────────────────
  // Step A — 定休曜日・祝日を '公' で確定
  // Step B — offBudget を計算し残り空きスロットへ均等配置、残りは '日'
  // 明けは夜勤の構造的付随物なので off 予算にカウントしない
  const OFF_CODES = new Set<ShiftCode>(['公', '有', '他', '希休'])

  staff.forEach((s) => {
    const offDow = new Set(s.off_days_of_week ?? [])

    // Step A: 強制休を先に確定
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[s.id][dayIdx] !== '') continue
      const date = new Date(year, month - 1, dayIdx + 1)
      const dow = date.getDay()
      const isHoliday = HolidayJP.isHoliday(date)
      if (offDow.has(dow) || (s.off_on_holidays && isHoliday)) {
        grid[s.id][dayIdx] = '公'
      }
    }

    // Step B: offBudget を計算し、残りの空きスロットへ均等配置
    const totalOffs = grid[s.id].filter((c) => OFF_CODES.has(c)).length
    const offBudget = Math.max(0, targetOffDays - totalOffs)

    const emptyIndices: number[] = []
    for (let i = 0; i < daysInMonth; i++) {
      if (grid[s.id][i] === '') emptyIndices.push(i)
    }

    const offPositions = new Set<number>()
    const pickCount = Math.min(offBudget, emptyIndices.length)
    for (let k = 0; k < pickCount; k++) {
      const raw = Math.round(((k + 0.5) * emptyIndices.length) / pickCount)
      const clamped = Math.max(0, Math.min(emptyIndices.length - 1, raw))
      offPositions.add(emptyIndices[clamped])
    }
    let remaining = pickCount - offPositions.size
    for (const idx of emptyIndices) {
      if (remaining <= 0) break
      if (!offPositions.has(idx)) {
        offPositions.add(idx)
        remaining--
      }
    }

    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[s.id][dayIdx] !== '') continue
      const consec = consecutiveWorkEndingAt(grid[s.id], dayIdx - 1)
      if (offPositions.has(dayIdx) || consec >= maxConsecutive) {
        grid[s.id][dayIdx] = '公'
      } else {
        grid[s.id][dayIdx] = '日'
      }
    }
  })

  // ── Pass 3.5: 平日の最低日勤人数確保 ────────────────────────────────────
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const date35 = new Date(year, month - 1, dayIdx + 1)
    const dow35 = date35.getDay()
    if (dow35 === 0 || dow35 === 6 || HolidayJP.isHoliday(date35)) continue
    let currentDay35 = staff.filter((s) => grid[s.id][dayIdx] === '日').length
    if (currentDay35 >= minDay) continue

    const candidates35 = staff
      .filter((s) =>
        grid[s.id][dayIdx] === '公' &&
        (dayIdx === 0 || grid[s.id][dayIdx - 1] !== '明') &&
        runLengthIfWorkAt(grid[s.id], dayIdx) <= maxConsecutive
      )
      .sort((a, b) => countVisibleOffs(grid[b.id]) - countVisibleOffs(grid[a.id]))

    for (const s of candidates35) {
      if (currentDay35 >= minDay) break
      grid[s.id][dayIdx] = '日'
      currentDay35++
    }

    if (currentDay35 < minDay) {
      warnings.push(`${dayIdx + 1}日(平日): 日勤 最低${minDay}人に対し${currentDay35}人しか確保できません`)
    }
  }

  // ── Pass 3.6: 土日祝の日勤人数を上限以下に抑制 ─────────────────────────
  // min_staff_weekend を「土日祝の目標上限」として使用（超過分は公休に変換）
  const maxWeekend = constraints?.min_staff_weekend ?? 2
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const date36 = new Date(year, month - 1, dayIdx + 1)
    const dow36 = date36.getDay()
    if (dow36 !== 0 && dow36 !== 6 && !HolidayJP.isHoliday(date36)) continue
    let currentDay36 = staff.filter((s) => grid[s.id][dayIdx] === '日').length
    if (currentDay36 <= maxWeekend) continue

    // 休日数が少ない（多く働いている）人から優先して公休に
    const excess36 = staff
      .filter((s) => grid[s.id][dayIdx] === '日')
      .sort((a, b) => countVisibleOffs(grid[a.id]) - countVisibleOffs(grid[b.id]))

    for (const s of excess36) {
      if (currentDay36 <= maxWeekend) break
      grid[s.id][dayIdx] = '公'
      currentDay36--
    }
  }

  // ── Pass 4: お風呂の日の最低人数確保 ─────────────────────────────────
  function runLengthIfWorkAt(shifts: ShiftCode[], dayIdx: number): number {
    let prev = 0
    for (let i = dayIdx - 1; i >= 0 && isWork(shifts[i]); i--) prev++
    let next = 0
    for (let i = dayIdx + 1; i < daysInMonth && isWork(shifts[i]); i++) next++
    return prev + 1 + next
  }

  const bathSwapCount: Record<string, number> = {}
  staff.forEach((s) => { bathSwapCount[s.id] = 0 })

  function eligibleForBathSwap(s: StaffProfile, dayIdx: number): boolean {
    if (grid[s.id][dayIdx] !== '公') return false
    if (dayIdx > 0 && grid[s.id][dayIdx - 1] === '明') return false  // 明け翌日は厳禁
    return runLengthIfWorkAt(grid[s.id], dayIdx) <= maxConsecutive
  }

  for (const dayIdx of bathDayIndices) {
    let currentDay = staff.filter((s) => grid[s.id][dayIdx] === '日').length
    if (currentDay >= minBathDay) continue

    const overTarget = staff
      .filter((s) => eligibleForBathSwap(s, dayIdx))
      .filter((s) => countVisibleOffs(grid[s.id]) > targetOffDays)
      .sort((a, b) => countVisibleOffs(grid[b.id]) - countVisibleOffs(grid[a.id]))

    for (const s of overTarget) {
      if (currentDay >= minBathDay) break
      grid[s.id][dayIdx] = '日'
      bathSwapCount[s.id]++
      currentDay++
    }

    if (currentDay >= minBathDay) continue

    const fairRotation = staff
      .filter((s) => eligibleForBathSwap(s, dayIdx))
      .sort((a, b) => {
        if (bathSwapCount[a.id] !== bathSwapCount[b.id]) return bathSwapCount[a.id] - bathSwapCount[b.id]
        return countVisibleOffs(grid[b.id]) - countVisibleOffs(grid[a.id])
      })

    for (const s of fairRotation) {
      if (currentDay >= minBathDay) break
      grid[s.id][dayIdx] = '日'
      bathSwapCount[s.id]++
      currentDay++
    }

    if (currentDay < minBathDay) {
      warnings.push(`${dayIdx + 1}日(お風呂): 日勤 最低${minBathDay}人に対し${currentDay}人しか確保できません`)
    }
  }

  // ── Pass 4.5: Pass 4 で swap されて target を下回ったスタッフを補填 ────
  const bathDaySet = new Set(bathDayIndices)
  staff.forEach((s, staffIdx) => {
    const deficit = targetOffDays - countVisibleOffs(grid[s.id])
    if (deficit <= 0) return

    const eligible: number[] = []
    for (let d = 0; d < daysInMonth; d++) {
      if (grid[s.id][d] !== '日' || bathDaySet.has(d)) continue
      const date = new Date(year, month - 1, d + 1)
      const dow = date.getDay()
      if (dow === 0 || dow === 6 || HolidayJP.isHoliday(date)) continue
      // 平日最低人数を割り込む日は除外
      const dayCount45 = staff.filter((o) => grid[o.id][d] === '日').length
      if (dayCount45 <= minDay) continue
      eligible.push(d)
    }
    const pickCount = Math.min(deficit, eligible.length)
    if (pickCount === 0) return

    const chunkSize = eligible.length / pickCount
    const offset = staffIdx % Math.max(1, Math.round(chunkSize))
    const chosen = new Set<number>()
    for (let k = 0; k < pickCount; k++) {
      const raw = Math.round(k * chunkSize + offset)
      chosen.add(eligible[Math.max(0, Math.min(eligible.length - 1, raw))])
    }
    let remaining = pickCount - chosen.size
    for (const d of eligible) {
      if (remaining <= 0) break
      if (!chosen.has(d)) { chosen.add(d); remaining-- }
    }
    chosen.forEach((d) => { grid[s.id][d] = '公' })
  })

  // ── Pass 4.6: 土日祝の最低人数確保（Pass 3.6 で減らしすぎた場合の安全網） ──
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const date46 = new Date(year, month - 1, dayIdx + 1)
    const dow = date46.getDay()
    if (dow !== 0 && dow !== 6 && !HolidayJP.isHoliday(date46)) continue
    let currentDay = staff.filter((s) => grid[s.id][dayIdx] === '日').length
    if (currentDay >= maxWeekend) continue

    const candidates = staff
      .filter((s) =>
        grid[s.id][dayIdx] === '公' &&
        (dayIdx === 0 || grid[s.id][dayIdx - 1] !== '明') &&
        runLengthIfWorkAt(grid[s.id], dayIdx) <= maxConsecutive
      )
      .sort((a, b) => countVisibleOffs(grid[b.id]) - countVisibleOffs(grid[a.id]))

    for (const s of candidates) {
      if (currentDay >= maxWeekend) break
      grid[s.id][dayIdx] = '日'
      currentDay++
    }

    if (currentDay < maxWeekend) {
      warnings.push(`${dayIdx + 1}日(土日祝): 日勤 最低${maxWeekend}人に対し${currentDay}人しか確保できません`)
    }
  }

  // ── Pass 4.7: 日勤 0 人の日を安全網として修正 ─────────────────────────
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    if (staff.some((s) => grid[s.id][dayIdx] === '日')) continue

    const candidates = staff
      .filter((s) =>
        grid[s.id][dayIdx] === '公' &&
        (dayIdx === 0 || grid[s.id][dayIdx - 1] !== '明') &&
        runLengthIfWorkAt(grid[s.id], dayIdx) <= maxConsecutive
      )
      .sort((a, b) => countVisibleOffs(grid[b.id]) - countVisibleOffs(grid[a.id]))

    if (candidates.length > 0) {
      grid[candidates[0].id][dayIdx] = '日'
    } else {
      warnings.push(`${dayIdx + 1}日: 日勤スタッフを確保できませんでした`)
    }
  }

  // ── Pass 4.8: 最終 off 数補填（Pass 4.6/4.7 の公→日 swap 後の不足を回収） ─
  // 土日祝・お風呂の日は除外（Pass 4.6 の成果を打ち消さないため）
  staff.forEach((s, staffIdx) => {
    const deficit = targetOffDays - countVisibleOffs(grid[s.id])
    if (deficit <= 0) return
    const eligible: number[] = []
    for (let d = 0; d < daysInMonth; d++) {
      if (grid[s.id][d] !== '日' || bathDaySet.has(d)) continue
      const date = new Date(year, month - 1, d + 1)
      const dow = date.getDay()
      if (dow === 0 || dow === 6 || HolidayJP.isHoliday(date)) continue
      // 平日最低人数を割り込む日は除外
      const dayCount48 = staff.filter((o) => grid[o.id][d] === '日').length
      if (dayCount48 <= minDay) continue
      eligible.push(d)
    }
    const pickCount = Math.min(deficit, eligible.length)
    if (pickCount === 0) return
    const chunkSize = eligible.length / pickCount
    const offset = staffIdx % Math.max(1, Math.round(chunkSize))
    const chosen = new Set<number>()
    for (let k = 0; k < pickCount; k++) {
      const raw = Math.round(k * chunkSize + offset)
      chosen.add(eligible[Math.max(0, Math.min(eligible.length - 1, raw))])
    }
    let rem = pickCount - chosen.size
    for (const d of eligible) {
      if (rem <= 0) break
      if (!chosen.has(d)) { chosen.add(d); rem-- }
    }
    chosen.forEach((d) => { grid[s.id][d] = '公' })
  })

  // ── Pass 5: Fix consecutive work violations ──────────────────────────────
  staff.forEach((s) => {
    for (let dayIdx = maxConsecutive; dayIdx < daysInMonth; dayIdx++) {
      if (consecutiveWorkEndingAt(grid[s.id], dayIdx) > maxConsecutive) {
        for (let back = dayIdx - maxConsecutive + 1; back <= dayIdx; back++) {
          if (grid[s.id][back] === '日') {
            grid[s.id][back] = '公'
            break
          }
        }
      }
    }
  })

  // ── Pass 6: Pair constraints ─────────────────────────────────────────────
  pairConstraints.forEach((pc) => {
    if (pc.constraint_type === 'must_not_pair') {
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        const codeA = grid[pc.staff_id_a]?.[dayIdx]
        const codeB = grid[pc.staff_id_b]?.[dayIdx]
        if (!codeA || !codeB || codeA !== codeB || !isWork(codeA)) continue
        if (grid[pc.staff_id_b]) grid[pc.staff_id_b][dayIdx] = '日'
      }
    } else if (pc.constraint_type === 'must_pair') {
      let violations = 0
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        const codeA = grid[pc.staff_id_a]?.[dayIdx]
        const codeB = grid[pc.staff_id_b]?.[dayIdx]
        if (isWork(codeA ?? '') && isWork(codeB ?? '') && codeA !== codeB) violations++
      }
      if (violations > 0) {
        warnings.push(`必ペア制約: ${violations}日間ペアが組めませんでした`)
      }
    }
  })

  // ── Pass 7: Remove orphan 明 (明 not preceded by 夜) ───────────────────
  staff.forEach((s) => {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[s.id][dayIdx] !== '明') continue
      const prev = dayIdx > 0 ? grid[s.id][dayIdx - 1] : ('' as ShiftCode)
      if (prev !== '夜') {
        grid[s.id][dayIdx] = '公'
      }
    }
  })

  // 休日数ズレ警告（目標 ±1 以上は警告）
  staff.forEach((s) => {
    const offs = countVisibleOffs(grid[s.id])
    const diff = offs - targetOffDays
    if (diff < -1) warnings.push(`${s.name}: 休日数 ${offs}日（目標 ${targetOffDays}日・${Math.abs(diff)}日不足）`)
    else if (diff > 1) warnings.push(`${s.name}: 休日数 ${offs}日（目標 ${targetOffDays}日・${diff}日超過）`)
  })

  return { grid, warnings, targetOffDays }
}
