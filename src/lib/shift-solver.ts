import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import GLPKFactory from 'glpk.js/node'
import type { GLPK, LP } from 'glpk.js/node'
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

type ShiftPreference = { kind: 'day' | 'night' }
type FixedLeaveCode = Extract<ShiftCode, '有' | '他' | '希休'>
type DayMeta = { isWeekend: boolean; label: string }

let glpkPromise: Promise<GLPK> | null = null

function getGlpk(): Promise<GLPK> {
  glpkPromise ??= GLPKFactory()
  return glpkPromise
}

function varName(prefix: 'n' | 'w' | 'r', staffId: string, dayIdx: number): string {
  return `${prefix}__${staffId}__${dayIdx}`
}

function emptyGrid(staff: StaffProfile[], daysInMonth: number): ShiftGrid {
  return Object.fromEntries(
    staff.map((member) => [member.id, Array(daysInMonth).fill('') as ShiftCode[]]),
  )
}

function leaveTypeToCode(type: string): FixedLeaveCode | null {
  switch (type) {
    case '希望休':
      return '希休'
    case '有給':
      return '有'
    case '特別休暇':
    case '他':
      return '他'
    default:
      return null
  }
}

function buildPrevMonthInfo(
  staff: StaffProfile[],
  prevMonthTail: SolverInput['prevMonthTail'],
  daysInMonth: number,
) {
  const prevNightAtMinus1 = new Map<string, boolean>()
  const prevNightAtMinus2 = new Map<string, boolean>()
  const fixedRestDays = new Map<string, Set<number>>()
  const forcedAkeDays = new Map<string, Set<number>>()

  for (const member of staff) {
    prevNightAtMinus1.set(member.id, false)
    prevNightAtMinus2.set(member.id, false)
    fixedRestDays.set(member.id, new Set<number>())
    forcedAkeDays.set(member.id, new Set<number>())
  }

  if (!prevMonthTail) {
    return { prevNightAtMinus1, prevNightAtMinus2, fixedRestDays, forcedAkeDays }
  }

  const byStaff = new Map<string, Map<number, string>>()
  for (const item of prevMonthTail) {
    const days = byStaff.get(item.staff_id) ?? new Map<number, string>()
    days.set(item.day, item.shift_code)
    byStaff.set(item.staff_id, days)
  }

  for (const member of staff) {
    const days = byStaff.get(member.id)
    if (!days || days.size === 0) continue

    const lastDay = Math.max(...days.keys())
    const lastCode = days.get(lastDay) ?? ''
    const secondLastCode = days.get(lastDay - 1) ?? ''

    const nightMinus1 = lastCode === '夜'
    const nightMinus2 = secondLastCode === '夜'
    prevNightAtMinus1.set(member.id, nightMinus1)
    prevNightAtMinus2.set(member.id, nightMinus2)

    if (nightMinus1) {
      forcedAkeDays.get(member.id)?.add(0)
      fixedRestDays.get(member.id)?.add(0)
      if (daysInMonth > 1) fixedRestDays.get(member.id)?.add(1)
      continue
    }

    if (lastCode === '明' || nightMinus2) {
      fixedRestDays.get(member.id)?.add(0)
    }
  }

  return { prevNightAtMinus1, prevNightAtMinus2, fixedRestDays, forcedAkeDays }
}

function getFixedLeaveData(leaveRequests: LeaveRequest[], year: number, month: number) {
  const fixedLeaveCodes = new Map<string, Map<number, FixedLeaveCode>>()
  const shiftPreferences = new Map<string, Map<number, ShiftPreference>>()

  for (const request of leaveRequests) {
    const [reqYear, reqMonth, reqDay] = request.date.split('-').map(Number)
    if (reqYear !== year || reqMonth !== month) continue
    const dayIdx = reqDay - 1
    if (dayIdx < 0) continue

    if (request.type === 'シフト希望') {
      const preferred = request.preferred_shift_type
      if (!preferred) continue
      const byDay = shiftPreferences.get(request.staff_id) ?? new Map<number, ShiftPreference>()
      byDay.set(dayIdx, { kind: preferred.is_overnight ? 'night' : 'day' })
      shiftPreferences.set(request.staff_id, byDay)
      continue
    }

    const leaveCode = leaveTypeToCode(request.type)
    if (!leaveCode) continue
    const byDay = fixedLeaveCodes.get(request.staff_id) ?? new Map<number, FixedLeaveCode>()
    byDay.set(dayIdx, leaveCode)
    fixedLeaveCodes.set(request.staff_id, byDay)
  }

  return { fixedLeaveCodes, shiftPreferences }
}

function buildDayMeta(year: number, month: number, daysInMonth: number): DayMeta[] {
  return Array.from({ length: daysInMonth }, (_, dayIdx) => {
    const date = new Date(year, month - 1, dayIdx + 1)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6 || HolidayJP.isHoliday(date)
    return {
      isWeekend,
      label: isWeekend ? `${dayIdx + 1}日(土日祝)` : `${dayIdx + 1}日(平日)`,
    }
  })
}

function getNightTarget(totalRequiredNights: number, staff: StaffProfile[]): Map<string, number> {
  const targetByStaff = new Map<string, number>()
  const eligible = staff.filter((member) => member.max_night_shifts > 0)
  const totalCapacity = eligible.reduce((sum, member) => sum + member.max_night_shifts, 0)

  for (const member of staff) {
    if (member.max_night_shifts <= 0 || totalCapacity === 0) {
      targetByStaff.set(member.id, 0)
      continue
    }
    targetByStaff.set(member.id, (totalRequiredNights * member.max_night_shifts) / totalCapacity)
  }

  return targetByStaff
}

function getGridCode(
  resultVars: Record<string, number>,
  staffId: string,
  dayIdx: number,
  forcedAkeDays: Set<number>,
  fixedLeaveCodes: Map<number, FixedLeaveCode> | undefined,
): ShiftCode {
  const nightToday = (resultVars[varName('n', staffId, dayIdx)] ?? 0) > 0.5
  if (nightToday) return '夜'
  if (forcedAkeDays.has(dayIdx)) return '明'
  if (dayIdx > 0 && (resultVars[varName('n', staffId, dayIdx - 1)] ?? 0) > 0.5) return '明'
  if ((resultVars[varName('w', staffId, dayIdx)] ?? 0) > 0.5) return '日'
  return fixedLeaveCodes?.get(dayIdx) ?? '公'
}

function countVisibleOffs(shifts: ShiftCode[]): number {
  return shifts.filter((code) => code === '公' || code === '有' || code === '他' || code === '希休').length
}

function consecutiveWorkEndingAt(shifts: ShiftCode[], dayIdx: number): number {
  let count = 0
  for (let idx = dayIdx; idx >= 0; idx--) {
    const code = shifts[idx]
    if (code === '日' || code === '夜') count += 1
    else break
  }
  return count
}

function addPostSolveWarnings(args: {
  staff: StaffProfile[]
  grid: ShiftGrid
  warnings: string[]
  dayMeta: DayMeta[]
  minNight: number
  minDay: number
  minWeekend: number
  maxWeekend: number
  maxConsecutive: number
  targetOffDays: number
  pairConstraints: StaffPairConstraint[]
}) {
  const {
    staff,
    grid,
    warnings,
    dayMeta,
    minNight,
    minDay,
    minWeekend,
    maxWeekend,
    maxConsecutive,
    targetOffDays,
    pairConstraints,
  } = args

  for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
    const nightCount = staff.filter((member) => grid[member.id][dayIdx] === '夜').length
    if (nightCount < minNight) {
      warnings.push(`${dayIdx + 1}日: 夜勤 最低${minNight}人に対し${nightCount}人しか確保できません`)
    }

    const dayCount = staff.filter((member) => grid[member.id][dayIdx] === '日').length
    if (dayMeta[dayIdx].isWeekend) {
      if (dayCount < minWeekend) {
        warnings.push(`${dayIdx + 1}日(土日祝): 日勤 最低${minWeekend}人に対し${dayCount}人しか確保できません`)
      }
      if (dayCount > maxWeekend) {
        warnings.push(`${dayIdx + 1}日(土日祝): 日勤 上限${maxWeekend}人に対し${dayCount}人です`)
      }
    } else if (dayCount < minDay) {
      warnings.push(`${dayIdx + 1}日(平日): 日勤 最低${minDay}人に対し${dayCount}人しか確保できません`)
    }
  }

  for (const member of staff) {
    const shifts = grid[member.id]
    const nightCount = shifts.filter((code) => code === '夜').length
    if (nightCount > member.max_night_shifts) {
      warnings.push(`${member.name}: 夜勤回数 ${nightCount}回（上限 ${member.max_night_shifts}回）`)
    }

    for (let dayIdx = maxConsecutive; dayIdx < shifts.length; dayIdx++) {
      const streak = consecutiveWorkEndingAt(shifts, dayIdx)
      if (streak > maxConsecutive) {
        warnings.push(`${member.name}: ${dayIdx + 1}日時点で連勤 ${streak}日です`)
        break
      }
    }

    const diff = countVisibleOffs(shifts) - targetOffDays
    if (diff < 0) warnings.push(`${member.name}: 休日数 ${targetOffDays + diff}日（目標 ${targetOffDays}日・${Math.abs(diff)}日不足）`)
    if (diff > 0) warnings.push(`${member.name}: 休日数 ${targetOffDays + diff}日（目標 ${targetOffDays}日・${diff}日超過）`)
  }

  for (const pair of pairConstraints) {
    if (pair.constraint_type === 'must_not_pair') {
      for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
        const a = grid[pair.staff_id_a]?.[dayIdx]
        const b = grid[pair.staff_id_b]?.[dayIdx]
        if (a === '夜' && b === '夜') {
          warnings.push(`ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} が同日夜勤になっています`)
        }
      }
      continue
    }

    if (pair.constraint_type === 'must_pair') {
      let violationDays = 0
      for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
        const a = grid[pair.staff_id_a]?.[dayIdx]
        const b = grid[pair.staff_id_b]?.[dayIdx]
        if ((a === '日' || a === '夜') && (b === '日' || b === '夜') && a !== b) {
          violationDays += 1
        }
      }
      if (violationDays > 0) {
        warnings.push(`必ペア制約: ${violationDays}日間ペアが揃いませんでした`)
      }
    }
  }
}

export async function generateShifts(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, prevMonthTail } = input
  const warnings: string[] = []

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const grid = emptyGrid(staff, daysInMonth)

  const minPerShift = constraints?.min_staff_per_shift ?? {}
  const minNight = minPerShift['夜勤'] ?? 2
  const minDay = minPerShift['日勤'] ?? 3
  const minWeekend = constraints?.min_staff_weekend ?? 3
  const maxWeekend = constraints?.max_staff_weekend ?? 4
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const targetOffDays = constraints?.target_off_days ?? Math.round(daysInMonth * 0.27)

  const dayMeta = buildDayMeta(year, month, daysInMonth)
  const { prevNightAtMinus1, prevNightAtMinus2, fixedRestDays, forcedAkeDays } = buildPrevMonthInfo(
    staff,
    prevMonthTail,
    daysInMonth,
  )
  const { fixedLeaveCodes, shiftPreferences } = getFixedLeaveData(leaveRequests, year, month)

  let glpk: GLPK
  try {
    glpk = await getGlpk()
  } catch {
    return {
      grid,
      warnings: ['GLPK の初期化に失敗したため、空シフトを返しました'],
      targetOffDays,
    }
  }

  const objectiveVars: LP['objective']['vars'] = []
  const subjectTo: LP['subjectTo'] = []
  const bounds: NonNullable<LP['bounds']> = []
  const binaries: string[] = []

  const addBinary = (name: string) => {
    binaries.push(name)
    bounds.push({ name, type: glpk.GLP_DB, lb: 0, ub: 1 })
  }

  const addContinuous = (name: string) => {
    // GLP_LO: lower-bounded only (x >= 0). ub is ignored by GLPK.
    bounds.push({ name, type: glpk.GLP_LO, lb: 0, ub: 0 })
  }

  const addObjective = (name: string, coef: number) => {
    objectiveVars.push({ name, coef })
  }

  const addRow = (name: string, vars: LP['subjectTo'][number]['vars'], type: number, lb: number, ub = 0) => {
    subjectTo.push({ name, vars, bnds: { type, lb, ub } })
  }

  for (const member of staff) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      addBinary(varName('n', member.id, dayIdx))
      addBinary(varName('w', member.id, dayIdx))
      addBinary(varName('r', member.id, dayIdx))
    }
  }

  for (const member of staff) {
    const memberFixedLeaveCodes = fixedLeaveCodes.get(member.id)
    const memberShiftPrefs = shiftPreferences.get(member.id)
    const memberFixedRestDays = fixedRestDays.get(member.id) ?? new Set<number>()

    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const n = varName('n', member.id, dayIdx)
      const w = varName('w', member.id, dayIdx)
      const r = varName('r', member.id, dayIdx)

      addRow(
        `onehot__${member.id}__${dayIdx}`,
        [
          { name: n, coef: 1 },
          { name: w, coef: 1 },
          { name: r, coef: 1 },
        ],
        glpk.GLP_FX,
        1,
        1,
      )

      const pref = memberShiftPrefs?.get(dayIdx)
      if (pref?.kind === 'night') addRow(`pref_night__${member.id}__${dayIdx}`, [{ name: n, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (pref?.kind === 'day') addRow(`pref_day__${member.id}__${dayIdx}`, [{ name: w, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (memberFixedLeaveCodes?.has(dayIdx) || memberFixedRestDays.has(dayIdx)) {
        addRow(`fixed_rest__${member.id}__${dayIdx}`, [{ name: r, coef: 1 }], glpk.GLP_FX, 1, 1)
      }

      const date = new Date(year, month - 1, dayIdx + 1)
      const isHoliday = HolidayJP.isHoliday(date)
      const offDow = new Set(member.off_days_of_week ?? [])
      if (member.off_days_constraint === 'hard' && (offDow.has(date.getDay()) || (member.off_on_holidays && isHoliday))) {
        addRow(`fixed_offday__${member.id}__${dayIdx}`, [{ name: r, coef: 1 }], glpk.GLP_FX, 1, 1)
      }

      const prevNightConstant = dayIdx === 0 ? (prevNightAtMinus1.get(member.id) ? 1 : 0) : 0
      const prevNightVars: LP['subjectTo'][number]['vars'] = dayIdx === 0
        ? [
            { name: w, coef: 1 },
            { name: n, coef: 1 },
          ]
        : [
            { name: varName('n', member.id, dayIdx - 1), coef: 1 },
            { name: w, coef: 1 },
            { name: n, coef: 1 },
          ]
      const prevNightUb = dayIdx === 0 ? 1 - prevNightConstant : 1
      addRow(`ake_block__${member.id}__${dayIdx}`, prevNightVars, glpk.GLP_UP, 0, prevNightUb)

      const h2Vars: LP['subjectTo'][number]['vars'] = [{ name: r, coef: 1 }]
      let h2Lb = 0
      if (dayIdx >= 2) {
        h2Vars.push({ name: varName('n', member.id, dayIdx - 2), coef: -1 })
      } else if (dayIdx === 1 && prevNightAtMinus1.get(member.id)) {
        h2Lb = 1
      } else if (dayIdx === 0 && prevNightAtMinus2.get(member.id)) {
        h2Lb = 1
      }
      addRow(`h2_rest__${member.id}__${dayIdx}`, h2Vars, glpk.GLP_LO, h2Lb, 0)
    }

    const workVars: LP['subjectTo'][number]['vars'] = []
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      workVars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
    }
    addRow(`night_cap__${member.id}`, workVars, glpk.GLP_UP, 0, member.max_night_shifts)

    for (let start = 0; start + maxConsecutive < daysInMonth; start++) {
      const vars: LP['subjectTo'][number]['vars'] = []
      for (let dayIdx = start; dayIdx <= start + maxConsecutive; dayIdx++) {
        vars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
        vars.push({ name: varName('w', member.id, dayIdx), coef: 1 })
      }
      addRow(
        `consecutive__${member.id}__${start}`,
        vars,
        glpk.GLP_UP,
        0,
        maxConsecutive,
      )
    }

    const offPos = `off_pos__${member.id}`
    const offNeg = `off_neg__${member.id}`
    addContinuous(offPos)
    addContinuous(offNeg)
    addObjective(offPos, 10)
    addObjective(offNeg, 10)

    const offVars: LP['subjectTo'][number]['vars'] = [
      { name: offPos, coef: -1 },
      { name: offNeg, coef: 1 },
    ]
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      offVars.push({ name: varName('r', member.id, dayIdx), coef: 1 })
    }
    const offTarget = targetOffDays + (prevNightAtMinus1.get(member.id) ? 1 : 0)
    addRow(`off_target__${member.id}`, offVars, glpk.GLP_FX, offTarget, offTarget)

    const nightPos = `night_pos__${member.id}`
    const nightNeg = `night_neg__${member.id}`
    addContinuous(nightPos)
    addContinuous(nightNeg)
    addObjective(nightPos, 5)
    addObjective(nightNeg, 5)

    const nightTarget = getNightTarget(daysInMonth * minNight, staff).get(member.id) ?? 0
    const nightVars: LP['subjectTo'][number]['vars'] = [
      { name: nightPos, coef: -1 },
      { name: nightNeg, coef: 1 },
    ]
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      nightVars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
    }
    addRow(`night_target__${member.id}`, nightVars, glpk.GLP_FX, nightTarget, nightTarget)
  }

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const nightVars = staff.map((member) => ({ name: varName('n', member.id, dayIdx), coef: 1 }))
    addRow(`min_night__${dayIdx}`, nightVars, glpk.GLP_LO, minNight, 0)

    const dayVars = staff.map((member) => ({ name: varName('w', member.id, dayIdx), coef: 1 }))
    if (dayMeta[dayIdx].isWeekend) {
      addRow(`max_weekend__${dayIdx}`, dayVars, glpk.GLP_UP, 0, maxWeekend)

      const shortfall = `weekend_short__${dayIdx}`
      addContinuous(shortfall)
      addObjective(shortfall, 2)
      addRow(
        `weekend_shortfall__${dayIdx}`,
        [...dayVars, { name: shortfall, coef: 1 }],
        glpk.GLP_LO,
        minWeekend,
        0,
      )
    } else {
      addRow(`min_day__${dayIdx}`, dayVars, glpk.GLP_LO, minDay, 0)
    }
  }

  for (const pair of pairConstraints) {
    if (pair.constraint_type !== 'must_not_pair') continue
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      addRow(
        `must_not_pair__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
        [
          { name: varName('n', pair.staff_id_a, dayIdx), coef: 1 },
          { name: varName('n', pair.staff_id_b, dayIdx), coef: 1 },
        ],
        glpk.GLP_UP,
        0,
        1,
      )
    }
  }

  const lp: LP = {
    name: `shift_solver_${yearMonth}`,
    objective: {
      direction: glpk.GLP_MIN,
      name: 'penalty',
      vars: objectiveVars,
    },
    subjectTo,
    bounds,
    binaries,
  }

  let solveResult: Awaited<ReturnType<GLPK['solve']>>
  try {
    solveResult = glpk.solve(lp, {
      msglev: glpk.GLP_MSG_OFF,
      presol: true,
      tmlim: 30,
    })
  } catch {
    return {
      grid,
      warnings: ['ILP の求解に失敗したため、空シフトを返しました'],
      targetOffDays,
    }
  }

  const status = solveResult.result.status
  if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) {
    return {
      grid,
      warnings: ['制約が充足不能のため、空シフトを返しました'],
      targetOffDays,
    }
  }

  const resultVars = solveResult.result.vars
  for (const member of staff) {
    const forcedAke = forcedAkeDays.get(member.id) ?? new Set<number>()
    const memberFixedLeaveCodes = fixedLeaveCodes.get(member.id)
    grid[member.id] = Array.from({ length: daysInMonth }, (_, dayIdx) =>
      getGridCode(resultVars, member.id, dayIdx, forcedAke, memberFixedLeaveCodes),
    )
  }

  addPostSolveWarnings({
    staff,
    grid,
    warnings,
    dayMeta,
    minNight,
    minDay,
    minWeekend,
    maxWeekend,
    maxConsecutive,
    targetOffDays,
    pairConstraints,
  })

  return { grid, warnings, targetOffDays }
}
