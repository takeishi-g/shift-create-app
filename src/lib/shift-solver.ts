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
}

export interface SolverOutput {
  grid: ShiftGrid
  warnings: string[]
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
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints } = input
  const warnings: string[] = []

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))

  const minPerShift = (constraints?.min_staff_per_shift ?? {}) as Record<string, number>
  const minNight       = minPerShift['夜勤'] ?? 2
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const autoInsertOff  = constraints?.auto_insert_off_after_night ?? true
  const targetOffDays  = (constraints as Record<string, unknown> | null)?.['target_off_days'] as number | undefined
    ?? Math.round(daysInMonth * 0.27)

  const grid: ShiftGrid = {}
  staff.forEach((s) => { grid[s.id] = Array(daysInMonth).fill('') as ShiftCode[] })

  // ── Pass 1: Fixed assignments from leave requests ────────────────────────
  leaveRequests.forEach((lr) => {
    const [ly, lm, ld] = lr.date.split('-').map(Number)
    if (ly !== year || lm !== month) return
    const dayIdx = ld - 1
    if (dayIdx < 0 || dayIdx >= daysInMonth || !grid[lr.staff_id]) return
    if (lr.type === 'シフト希望') return
    const code = leaveTypeToCode(lr.type)
    if (code) grid[lr.staff_id][dayIdx] = code
  })

  // ── Pass 2: Night shift distribution (even spread) ──────────────────────
  const nightCount: Record<string, number> = {}
  staff.forEach((s) => { nightCount[s.id] = 0 })

  function canAssignNight(shifts: ShiftCode[], dayIdx: number): boolean {
    if (shifts[dayIdx] !== '') return false
    if (dayIdx > 0 && (shifts[dayIdx - 1] === '夜' || shifts[dayIdx - 1] === '明')) return false
    if (consecutiveWorkEndingAt(shifts, dayIdx - 1) >= maxConsecutive) return false
    if (dayIdx + 1 < daysInMonth && shifts[dayIdx + 1] !== '' && shifts[dayIdx + 1] !== '明') return false
    return true
  }

  function assignNight(s: typeof staff[0], dayIdx: number) {
    grid[s.id][dayIdx] = '夜'
    nightCount[s.id]++
    if (dayIdx + 1 < daysInMonth) grid[s.id][dayIdx + 1] = '明'
    if (autoInsertOff && dayIdx + 2 < daysInMonth && grid[s.id][dayIdx + 2] === '') {
      grid[s.id][dayIdx + 2] = '公'
    }
  }

  // Phase A: 各スタッフの夜勤を月全体に均等分散
  // target は max_night_shifts ではなく「最低人数を全員で分担した公平数」に抑える
  // → Phase B が残りを補充できる余裕を確保する
  const fairShare = Math.ceil((minNight * daysInMonth) / staff.length)
  const sortedByNight = [...staff].sort((a, b) => b.max_night_shifts - a.max_night_shifts)
  sortedByNight.forEach((s) => {
    const target = Math.min(s.max_night_shifts, fairShare)
    if (target === 0) return
    const spacing = daysInMonth / target

    for (let i = 0; i < target; i++) {
      const ideal = Math.round(spacing * i + spacing / 2)
      const searchRadius = Math.ceil(spacing / 2)
      let assigned = false
      for (let r = 0; r <= searchRadius && !assigned; r++) {
        for (const offset of r === 0 ? [0] : [r, -r]) {
          const dayIdx = ideal + offset
          if (dayIdx < 0 || dayIdx >= daysInMonth) continue
          if (!canAssignNight(grid[s.id], dayIdx)) continue
          assignNight(s, dayIdx)
          assigned = true
          break
        }
      }
    }
  })

  // Phase B: 最低人数に満たない日を補充
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const currentNight = staff.filter((s) => grid[s.id][dayIdx] === '夜').length
    const needed = Math.max(0, minNight - currentNight)
    if (needed === 0) continue

    const eligible = staff
      .filter((s) => {
        if (!canAssignNight(grid[s.id], dayIdx)) return false
        if (nightCount[s.id] >= s.max_night_shifts) return false
        return true
      })
      .sort((a, b) => nightCount[a.id] - nightCount[b.id])

    const toAssign = Math.min(needed, eligible.length)
    for (let i = 0; i < toAssign; i++) assignNight(eligible[i], dayIdx)

    if (toAssign < needed) {
      warnings.push(`${dayIdx + 1}日: 夜勤 最低${minNight}人に対し${currentNight + toAssign}人しか確保できません`)
    }
  }

  // ── Pass 3: Fill remaining with 日勤 or 公休 ────────────────────────────
  staff.forEach((s) => {
    const offDow = new Set(s.off_days_of_week ?? [])

    // 明け含むすべての既存休日をカウント
    const currentOff = grid[s.id].filter((c) => c === '公' || c === '有' || c === '他' || c === '希休' || c === '明').length

    // 空きスロットのうち定休日に該当する日数を先読みしてoffBudgetから除く
    // （定休日は休日数の一部として扱う）
    const anticipatedForcedOff = grid[s.id].reduce((count, code, i) => {
      if (code !== '') return count
      const d = new Date(year, month - 1, i + 1)
      return (offDow.has(d.getDay()) || (s.off_on_holidays && HolidayJP.isHoliday(d)))
        ? count + 1
        : count
    }, 0)

    let offBudget = Math.max(0, targetOffDays - currentOff - anticipatedForcedOff)

    // 空きスロット全体に公休を均等配置（定休日スロットを除いた残りで計算）
    const totalEmpty = grid[s.id].filter((c) => c === '').length - anticipatedForcedOff
    const spacing = offBudget > 0 ? Math.max(1, Math.round(totalEmpty / offBudget) - 1) : Infinity
    let emptySeenSinceLastOff = 0

    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[s.id][dayIdx] !== '') continue
      const date = new Date(year, month - 1, dayIdx + 1)
      const dow = date.getDay()
      const consec = consecutiveWorkEndingAt(grid[s.id], dayIdx - 1)

      const isHoliday = HolidayJP.isHoliday(date)
      const forcedOff = offDow.has(dow) || (s.off_on_holidays && isHoliday)
      const budgetOff = !forcedOff && offBudget > 0 && emptySeenSinceLastOff >= spacing

      if (consec >= maxConsecutive || forcedOff || budgetOff) {
        grid[s.id][dayIdx] = '公'
        emptySeenSinceLastOff = 0
        if (budgetOff) offBudget--
      } else {
        grid[s.id][dayIdx] = '日'
        emptySeenSinceLastOff++
      }
    }
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

  return { grid, warnings }
}
