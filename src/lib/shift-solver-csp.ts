import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import GLPKFactory from 'glpk.js/node'
import type { GLPK, LP } from 'glpk.js/node'
import { LeaveRequest, ShiftConstraints, ShiftType, StaffPairConstraint, StaffProfile } from '@/types'

export type ShiftCode = '日' | '夜' | '明' | '公' | '有' | '他' | '希休' | ''
export type ShiftGrid = Record<string, ShiftCode[]>

export interface SolverInput {
  yearMonth: string
  staff: StaffProfile[]
  constraints: ShiftConstraints | null
  leaveRequests: LeaveRequest[]
  pairConstraints: StaffPairConstraint[]
  shiftTypes?: ShiftType[]
  bathDayIndices: number[]
  prevMonthTail?: { staff_id: string; shift_code: string; day: number }[]
}

export interface SolverOutput {
  grid: ShiftGrid
  warnings: string[]
  targetOffDays: number
  solverStatus: 'success' | 'infeasible' | 'error'
}

type FixedLeaveCode = Extract<ShiftCode, '有' | '他' | '希休'>
type DayMeta = { isWeekend: boolean; isBathDay: boolean }
type PrevMonthInfo = {
  forcedAkeDays: Map<string, Set<number>>
  fixedOffDays: Map<string, Set<number>>
  carryInWorkDays: Map<string, number>
}

let glpkPromise: Promise<GLPK> | null = null

function getGlpk(): Promise<GLPK> {
  glpkPromise ??= GLPKFactory()
  return glpkPromise
}

function varName(prefix: 'n' | 'w' | 'a' | 'o', staffId: string, dayIdx: number): string {
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

function isWorkShiftCode(code: string): boolean {
  return code === '日' || code === '夜'
}

function buildPrevMonthInfo(
  staff: StaffProfile[],
  prevMonthTail: SolverInput['prevMonthTail'],
  daysInMonth: number,
): PrevMonthInfo {
  const forcedAkeDays = new Map<string, Set<number>>()
  const fixedOffDays = new Map<string, Set<number>>()
  const carryInWorkDays = new Map<string, number>()

  for (const member of staff) {
    forcedAkeDays.set(member.id, new Set<number>())
    fixedOffDays.set(member.id, new Set<number>())
    carryInWorkDays.set(member.id, 0)
  }

  if (!prevMonthTail) return { forcedAkeDays, fixedOffDays, carryInWorkDays }

  const byStaff = new Map<string, Map<number, string>>()
  const tailByStaff = new Map<string, Array<{ day: number; shift_code: string }>>()
  for (const item of prevMonthTail) {
    const days = byStaff.get(item.staff_id) ?? new Map<number, string>()
    days.set(item.day, item.shift_code)
    byStaff.set(item.staff_id, days)

    const tail = tailByStaff.get(item.staff_id) ?? []
    tail.push({ day: item.day, shift_code: item.shift_code })
    tailByStaff.set(item.staff_id, tail)
  }

  for (const member of staff) {
    const days = byStaff.get(member.id)
    if (!days || days.size === 0) continue

    const tail = tailByStaff.get(member.id)
    if (!tail || tail.length === 0) continue
    tail.sort((a, b) => a.day - b.day)

    const lastDay = Math.max(...days.keys())
    const lastCode = days.get(lastDay) ?? ''
    const secondLastCode = days.get(lastDay - 1) ?? ''

    if (isWorkShiftCode(lastCode)) {
      let carryIn = 0
      let expectedDay = tail[tail.length - 1]?.day ?? 0
      for (let index = tail.length - 1; index >= 0; index -= 1) {
        const item = tail[index]
        if (item.day !== expectedDay || !isWorkShiftCode(item.shift_code)) break
        carryIn += 1
        expectedDay -= 1
      }
      carryInWorkDays.set(member.id, carryIn)
    }

    if (lastCode === '夜') {
      forcedAkeDays.get(member.id)?.add(0)
      if (daysInMonth > 1) fixedOffDays.get(member.id)?.add(1)
      continue
    }

    if (lastCode === '明' || secondLastCode === '夜') {
      fixedOffDays.get(member.id)?.add(0)
    }
  }

  return { forcedAkeDays, fixedOffDays, carryInWorkDays }
}

function buildFixedLeaveData(leaveRequests: LeaveRequest[], year: number, month: number) {
  const fixedLeaveCodes = new Map<string, Map<number, FixedLeaveCode>>()
  const shiftPreferences = new Map<string, Map<number, 'day' | 'night'>>()
  const paidLeaveCount = new Map<string, number>()

  for (const request of leaveRequests) {
    const [reqYear, reqMonth, reqDay] = request.date.split('-').map(Number)
    if (reqYear !== year || reqMonth !== month) continue
    const dayIdx = reqDay - 1
    if (dayIdx < 0) continue

    if (request.type === 'シフト希望') {
      const preferred = request.preferred_shift_type
      if (!preferred) continue
      const byDay = shiftPreferences.get(request.staff_id) ?? new Map<number, 'day' | 'night'>()
      byDay.set(dayIdx, preferred.is_overnight ? 'night' : 'day')
      shiftPreferences.set(request.staff_id, byDay)
      continue
    }

    const code = leaveTypeToCode(request.type)
    if (!code) continue
    const byDay = fixedLeaveCodes.get(request.staff_id) ?? new Map<number, FixedLeaveCode>()
    byDay.set(dayIdx, code)
    fixedLeaveCodes.set(request.staff_id, byDay)
    if (code === '有') {
      paidLeaveCount.set(request.staff_id, (paidLeaveCount.get(request.staff_id) ?? 0) + 1)
    }
  }

  return { fixedLeaveCodes, shiftPreferences, paidLeaveCount }
}

function buildDayMeta(year: number, month: number, daysInMonth: number, bathDayIndices: number[]): DayMeta[] {
  const bathSet = new Set(bathDayIndices)
  return Array.from({ length: daysInMonth }, (_, dayIdx) => {
    const date = new Date(year, month - 1, dayIdx + 1)
    return {
      isWeekend: date.getDay() === 0 || date.getDay() === 6 || HolidayJP.isHoliday(date),
      isBathDay: bathSet.has(dayIdx),
    }
  })
}

export function pairTargetsNight(pair: StaffPairConstraint): boolean {
  return pair.shift_type_id === null || pair.shift_type?.is_overnight === true
}

export function pairTargetsDay(pair: StaffPairConstraint): boolean {
  return pair.shift_type_id === null || pair.shift_type?.is_overnight === false
}

function getShiftMinimums(
  constraints: ShiftConstraints | null,
  shiftTypes: ShiftType[] | undefined,
  dayMeta: DayMeta[],
) {
  const nightShiftType = shiftTypes?.find((shiftType) => shiftType.is_overnight && !shiftType.is_off)
  const dayShiftType = shiftTypes?.find((shiftType) => !shiftType.is_overnight && !shiftType.is_off)
  const nightKey = nightShiftType?.name ?? '夜勤'
  const dayKey = dayShiftType?.name ?? '日勤'

  const minNightValue =
    constraints?.min_staff_per_shift?.[nightKey] ??
    constraints?.min_staff_per_shift?.['夜勤']
  const minDayValue =
    constraints?.min_staff_per_shift?.[dayKey] ??
    constraints?.min_staff_per_shift?.['日勤']
  const maxNightValue =
    constraints?.max_staff_per_shift?.[nightKey] ??
    constraints?.max_staff_per_shift?.['夜勤']
  const maxDayValue =
    constraints?.max_staff_per_shift?.[dayKey] ??
    constraints?.max_staff_per_shift?.['日勤']

  const minNight = Number.isFinite(Number(minNightValue)) ? Number(minNightValue) : 2
  const minDay = Number.isFinite(Number(minDayValue)) ? Number(minDayValue) : 3
  const maxNight = Number.isFinite(Number(maxNightValue)) ? Math.max(minNight, Number(maxNightValue)) : minNight
  const maxDay = Number.isFinite(Number(maxDayValue)) ? Math.max(minDay, Number(maxDayValue)) : minDay
  const minWeekend = constraints?.min_staff_weekend ?? minDay
  const maxWeekend = constraints?.max_staff_weekend ?? maxDay
  const minBathDay = constraints?.min_staff_bath_day ?? minDay

  const requiredDayByIndex = dayMeta.map((meta) => {
    let required = meta.isWeekend ? minWeekend : minDay
    if (meta.isBathDay) required = Math.max(required, minBathDay)
    return required
  })

  const maxDayByIndex = dayMeta.map((meta) => (meta.isWeekend ? maxWeekend : maxDay))

  return { minNight, minDay, maxNight, maxDay, requiredDayByIndex, maxDayByIndex }
}

function codeFromResult(
  resultVars: Record<string, number>,
  staffId: string,
  dayIdx: number,
  fixedLeaveCodes: Map<number, FixedLeaveCode> | undefined,
): ShiftCode {
  if ((resultVars[varName('n', staffId, dayIdx)] ?? 0) > 0.5) return '夜'
  if ((resultVars[varName('w', staffId, dayIdx)] ?? 0) > 0.5) return '日'
  if ((resultVars[varName('a', staffId, dayIdx)] ?? 0) > 0.5) return '明'
  return fixedLeaveCodes?.get(dayIdx) ?? '公'
}

function countWorkStreakEndingAt(shifts: ShiftCode[], dayIdx: number): number {
  let count = 0
  for (let idx = dayIdx; idx >= 0; idx--) {
    if (shifts[idx] === '日' || shifts[idx] === '夜') count += 1
    else break
  }
  return count
}

function buildInfeasibleDiagnostics(args: {
  staff: StaffProfile[]
  dayMeta: DayMeta[]
  minNight: number
  requiredDayByIndex: number[]
  personalTargetByStaff: Map<string, number>
  fixedLeaveCodes: Map<string, Map<number, FixedLeaveCode>>
  fixedOffDays: Map<string, Set<number>>
  forcedAkeDays: Map<string, Set<number>>
  carryInWorkDays: Map<string, number>
  pairConstraints: StaffPairConstraint[]
}) {
  const {
    staff,
    dayMeta,
    minNight,
    requiredDayByIndex,
    personalTargetByStaff,
    fixedLeaveCodes,
    fixedOffDays,
    forcedAkeDays,
    carryInWorkDays,
    pairConstraints,
  } = args

  const totalNightDemand = dayMeta.length * minNight
  const totalNightCapacity = staff.reduce((sum, member) => sum + member.max_night_shifts, 0)
  const totalDayDemand = requiredDayByIndex.reduce((sum, value) => sum + value, 0)
  const seniorCount = staff.filter((member) => member.role === '師長' || member.role === '主任').length
  const weekdayCount = dayMeta.filter((meta) => !meta.isWeekend).length

  return {
    totalNightDemand,
    totalNightCapacity,
    totalDayDemand,
    weekdayCount,
    seniorCount,
    mustPairCount: pairConstraints.filter((pair) => pair.constraint_type === 'must_pair').length,
    mustNotPairCount: pairConstraints.filter((pair) => pair.constraint_type === 'must_not_pair').length,
    staffSnapshots: staff.map((member) => ({
      id: member.id,
      name: member.name,
      targetOff: personalTargetByStaff.get(member.id) ?? 0,
      fixedLeaveDays: fixedLeaveCodes.get(member.id)?.size ?? 0,
      forcedOffDays: fixedOffDays.get(member.id)?.size ?? 0,
      forcedAkeDays: forcedAkeDays.get(member.id)?.size ?? 0,
      carryInWorkDays: carryInWorkDays.get(member.id) ?? 0,
      maxNightShifts: member.max_night_shifts,
    })),
  }
}

function addWarnings(args: {
  staff: StaffProfile[]
  grid: ShiftGrid
  warnings: string[]
  dayMeta: DayMeta[]
  minNight: number
  maxNight: number
  requiredDayByIndex: number[]
  maxDayByIndex: number[]
  maxConsecutive: number
  pairConstraints: StaffPairConstraint[]
  personalTargetByStaff: Map<string, number>
}) {
  const {
    staff,
    grid,
    warnings,
    dayMeta,
    minNight,
    maxNight,
    requiredDayByIndex,
    maxDayByIndex,
    maxConsecutive,
    pairConstraints,
    personalTargetByStaff,
  } = args

  for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
    const nightCount = staff.filter((member) => grid[member.id][dayIdx] === '夜').length
    const dayCount = staff.filter((member) => grid[member.id][dayIdx] === '日').length
    if (nightCount < minNight) {
      warnings.push(`${dayIdx + 1}日: 夜勤 ${nightCount}人（最低${minNight}人）`)
    }
    if (nightCount > maxNight) {
      warnings.push(`${dayIdx + 1}日: 夜勤 ${nightCount}人（上限${maxNight}人）`)
    }
    if (dayCount < requiredDayByIndex[dayIdx]) {
      warnings.push(`${dayIdx + 1}日${dayMeta[dayIdx].isWeekend ? '(土日祝)' : '(平日)'}: 日勤 ${dayCount}人（最低${requiredDayByIndex[dayIdx]}人）`)
    }
    if (dayCount > maxDayByIndex[dayIdx]) {
      warnings.push(`${dayIdx + 1}日${dayMeta[dayIdx].isWeekend ? '(土日祝)' : '(平日)'}: 日勤 ${dayCount}人（上限${maxDayByIndex[dayIdx]}人）`)
    }
  }

  for (const member of staff) {
    const shifts = grid[member.id]
    const visibleOffs = shifts.filter((code) => code === '公' || code === '有' || code === '他' || code === '希休').length
    const target = personalTargetByStaff.get(member.id) ?? 0
    if (visibleOffs !== target) {
      const diff = visibleOffs - target
      if (diff < 0) warnings.push(`${member.name}: 休日数 ${visibleOffs}日（目標 ${target}日・${Math.abs(diff)}日不足）`)
      if (diff > 0) warnings.push(`${member.name}: 休日数 ${visibleOffs}日（目標 ${target}日・${diff}日超過）`)
    }

    for (let dayIdx = maxConsecutive; dayIdx < shifts.length; dayIdx++) {
      const streak = countWorkStreakEndingAt(shifts, dayIdx)
      if (streak > maxConsecutive) {
        warnings.push(`${member.name}: ${dayIdx + 1}日時点で連勤 ${streak}日です`)
        break
      }
    }
  }

  for (const pair of pairConstraints) {
    for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
      const a = grid[pair.staff_id_a]?.[dayIdx]
      const b = grid[pair.staff_id_b]?.[dayIdx]
      if (pair.constraint_type === 'must_not_pair') {
        if (pairTargetsNight(pair) && a === '夜' && b === '夜') {
          warnings.push(`ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} が同日夜勤です`)
        }
        if (pairTargetsDay(pair) && a === '日' && b === '日') {
          warnings.push(`ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} が同日日勤です`)
        }
      } else {
        if (pairTargetsNight(pair) && ((a === '夜') !== (b === '夜'))) {
          warnings.push(`必ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} の夜勤が一致していません`)
          break
        }
        if (pairTargetsDay(pair) && ((a === '日') !== (b === '日'))) {
          warnings.push(`必ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} の日勤が一致していません`)
          break
        }
      }
    }
  }
}

export async function generateShifts(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, shiftTypes, bathDayIndices, prevMonthTail } = input
  const warnings: string[] = []

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const targetOffDays = constraints?.target_off_days ?? Math.round(daysInMonth * 0.27)
  const grid = emptyGrid(staff, daysInMonth)
  const dayMeta = buildDayMeta(year, month, daysInMonth, bathDayIndices)
  const { forcedAkeDays, fixedOffDays, carryInWorkDays } = buildPrevMonthInfo(staff, prevMonthTail, daysInMonth)
  const { fixedLeaveCodes, shiftPreferences, paidLeaveCount } = buildFixedLeaveData(leaveRequests, year, month)
  const { minNight, maxNight, requiredDayByIndex, maxDayByIndex } = getShiftMinimums(constraints, shiftTypes, dayMeta)
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const personalTargetByStaff = new Map<string, number>(
    staff.map((member) => [member.id, targetOffDays + (paidLeaveCount.get(member.id) ?? 0)]),
  )

  let glpk: GLPK
  try {
    glpk = await getGlpk()
  } catch {
    return {
      grid,
      warnings: ['GLPK の初期化に失敗しました'],
      targetOffDays,
      solverStatus: 'error',
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
      addBinary(varName('a', member.id, dayIdx))
      addBinary(varName('o', member.id, dayIdx))
    }
  }

  const nightTargetByStaff = (() => {
    const totalRequiredNights = daysInMonth * minNight
    const eligible = staff.filter((member) => member.max_night_shifts > 0)
    const totalCapacity = eligible.reduce((sum, member) => sum + member.max_night_shifts, 0)
    const targetMap = new Map<string, number>()
    for (const member of staff) {
      if (member.max_night_shifts <= 0 || totalCapacity === 0) {
        targetMap.set(member.id, 0)
        continue
      }
      targetMap.set(member.id, (totalRequiredNights * member.max_night_shifts) / totalCapacity)
    }
    return targetMap
  })()

  for (const member of staff) {
    const memberFixedLeaves = fixedLeaveCodes.get(member.id)
    const memberPrefs = shiftPreferences.get(member.id)
    const memberForcedAke = forcedAkeDays.get(member.id) ?? new Set<number>()
    const memberFixedOff = fixedOffDays.get(member.id) ?? new Set<number>()
    const carryInWork = carryInWorkDays.get(member.id) ?? 0
    const offDow = new Set(member.off_days_of_week ?? [])

    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const n = varName('n', member.id, dayIdx)
      const w = varName('w', member.id, dayIdx)
      const a = varName('a', member.id, dayIdx)
      const o = varName('o', member.id, dayIdx)

      addRow(
        `onehot__${member.id}__${dayIdx}`,
        [
          { name: n, coef: 1 },
          { name: w, coef: 1 },
          { name: a, coef: 1 },
          { name: o, coef: 1 },
        ],
        glpk.GLP_FX,
        1,
        1,
      )

      const date = new Date(year, month - 1, dayIdx + 1)
      const isHoliday = HolidayJP.isHoliday(date)
      const pref = memberPrefs?.get(dayIdx)
      const isHardOffDay =
        member.off_days_constraint === 'hard' &&
        (offDow.has(date.getDay()) || (member.off_on_holidays && isHoliday))

      if (pref === 'night') addRow(`pref_night__${member.id}__${dayIdx}`, [{ name: n, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (pref === 'day') addRow(`pref_day__${member.id}__${dayIdx}`, [{ name: w, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (memberForcedAke.has(dayIdx)) addRow(`forced_ake__${member.id}__${dayIdx}`, [{ name: a, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (memberFixedLeaves?.has(dayIdx) || memberFixedOff.has(dayIdx) || isHardOffDay) {
        addRow(`forced_off__${member.id}__${dayIdx}`, [{ name: o, coef: 1 }], glpk.GLP_FX, 1, 1)
      }

      if (dayIdx === 0) {
        const forcedAke = memberForcedAke.has(dayIdx) ? 1 : 0
        addRow(`ake_origin__${member.id}__${dayIdx}`, [{ name: a, coef: 1 }], glpk.GLP_FX, forcedAke, forcedAke)
      } else {
        addRow(
          `ake_origin__${member.id}__${dayIdx}`,
          [
            { name: a, coef: 1 },
            { name: varName('n', member.id, dayIdx - 1), coef: -1 },
          ],
          glpk.GLP_FX,
          0,
          0,
        )
      }

      if (dayIdx + 2 < daysInMonth) {
        addRow(
          `post_night_off__${member.id}__${dayIdx}`,
          [
            { name: varName('o', member.id, dayIdx + 2), coef: 1 },
            { name: n, coef: -1 },
          ],
          glpk.GLP_LO,
          0,
          0,
        )
      }
    }

    addRow(
      `night_cap__${member.id}`,
      Array.from({ length: daysInMonth }, (_, dayIdx) => ({
        name: varName('n', member.id, dayIdx),
        coef: 1,
      })),
      glpk.GLP_UP,
      0,
      member.max_night_shifts,
    )

    for (let start = 0; start + maxConsecutive < daysInMonth; start++) {
      const vars: LP['subjectTo'][number]['vars'] = []
      for (let dayIdx = start; dayIdx <= start + maxConsecutive; dayIdx++) {
        vars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
        vars.push({ name: varName('w', member.id, dayIdx), coef: 1 })
      }
      addRow(`consecutive__${member.id}__${start}`, vars, glpk.GLP_UP, 0, maxConsecutive)
    }

    if (carryInWork > 0) {
      const protectedPrefixLength = Math.min(daysInMonth, Math.max(1, maxConsecutive - carryInWork + 1))
      const vars: LP['subjectTo'][number]['vars'] = []
      for (let dayIdx = 0; dayIdx < protectedPrefixLength; dayIdx++) {
        vars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
        vars.push({ name: varName('w', member.id, dayIdx), coef: 1 })
      }
      addRow(
        `carry_in_consecutive__${member.id}`,
        vars,
        glpk.GLP_UP,
        0,
        Math.max(0, maxConsecutive - carryInWork),
      )
    }

    const offPos = `off_pos__${member.id}`
    const offNeg = `off_neg__${member.id}`
    addContinuous(offPos)
    addContinuous(offNeg)
    addObjective(offPos, 10)
    addObjective(offNeg, 10)
    addRow(
      `off_target__${member.id}`,
      [
        { name: offPos, coef: -1 },
        { name: offNeg, coef: 1 },
        ...Array.from({ length: daysInMonth }, (_, dayIdx) => ({
          name: varName('o', member.id, dayIdx),
          coef: 1,
        })),
      ],
      glpk.GLP_FX,
      personalTargetByStaff.get(member.id) ?? targetOffDays,
      personalTargetByStaff.get(member.id) ?? targetOffDays,
    )

    const nightPos = `night_pos__${member.id}`
    const nightNeg = `night_neg__${member.id}`
    addContinuous(nightPos)
    addContinuous(nightNeg)
    addObjective(nightPos, 5)
    addObjective(nightNeg, 5)
    addRow(
      `night_target__${member.id}`,
      [
        { name: nightPos, coef: -1 },
        { name: nightNeg, coef: 1 },
        ...Array.from({ length: daysInMonth }, (_, dayIdx) => ({
          name: varName('n', member.id, dayIdx),
          coef: 1,
        })),
      ],
      glpk.GLP_FX,
      nightTargetByStaff.get(member.id) ?? 0,
      nightTargetByStaff.get(member.id) ?? 0,
    )
  }

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    addRow(
      `min_night__${dayIdx}`,
      staff.map((member) => ({ name: varName('n', member.id, dayIdx), coef: 1 })),
      glpk.GLP_LO,
      minNight,
      0,
    )
    addRow(
      `max_night__${dayIdx}`,
      staff.map((member) => ({ name: varName('n', member.id, dayIdx), coef: 1 })),
      glpk.GLP_UP,
      0,
      maxNight,
    )
    addRow(
      `min_day__${dayIdx}`,
      staff.map((member) => ({ name: varName('w', member.id, dayIdx), coef: 1 })),
      glpk.GLP_LO,
      requiredDayByIndex[dayIdx],
      0,
    )
    addRow(
      `max_day__${dayIdx}`,
      staff.map((member) => ({ name: varName('w', member.id, dayIdx), coef: 1 })),
      glpk.GLP_UP,
      0,
      maxDayByIndex[dayIdx],
    )
  }

  const seniorStaff = staff.filter((member) => member.role === '師長' || member.role === '主任')
  if (seniorStaff.length > 0) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (dayMeta[dayIdx].isWeekend) continue
      addRow(
        `senior_day_coverage__${dayIdx}`,
        seniorStaff.map((member) => ({ name: varName('w', member.id, dayIdx), coef: 1 })),
        glpk.GLP_LO,
        1,
        0,
      )
    }
  }

  for (const pair of pairConstraints) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (pair.constraint_type === 'must_not_pair') {
        if (pairTargetsNight(pair)) {
          addRow(
            `must_not_pair_night__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
            [
              { name: varName('n', pair.staff_id_a, dayIdx), coef: 1 },
              { name: varName('n', pair.staff_id_b, dayIdx), coef: 1 },
            ],
            glpk.GLP_UP,
            0,
            1,
          )
        }
        if (pairTargetsDay(pair)) {
          addRow(
            `must_not_pair_day__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
            [
              { name: varName('w', pair.staff_id_a, dayIdx), coef: 1 },
              { name: varName('w', pair.staff_id_b, dayIdx), coef: 1 },
            ],
            glpk.GLP_UP,
            0,
            1,
          )
        }
        continue
      }

      if (pair.shift_type_id === null) {
        for (const prefix of ['n', 'w', 'a', 'o'] as const) {
          addRow(
            `must_pair_all__${prefix}__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
            [
              { name: varName(prefix, pair.staff_id_a, dayIdx), coef: 1 },
              { name: varName(prefix, pair.staff_id_b, dayIdx), coef: -1 },
            ],
            glpk.GLP_FX,
            0,
            0,
          )
        }
        continue
      }

      if (pairTargetsNight(pair)) {
        addRow(
          `must_pair_night__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
          [
            { name: varName('n', pair.staff_id_a, dayIdx), coef: 1 },
            { name: varName('n', pair.staff_id_b, dayIdx), coef: -1 },
          ],
          glpk.GLP_FX,
          0,
          0,
        )
      }
      if (pairTargetsDay(pair)) {
        addRow(
          `must_pair_day__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
          [
            { name: varName('w', pair.staff_id_a, dayIdx), coef: 1 },
            { name: varName('w', pair.staff_id_b, dayIdx), coef: -1 },
          ],
          glpk.GLP_FX,
          0,
          0,
        )
      }
    }
  }

  const lp: LP = {
    name: `shift_solver_csp_${yearMonth}`,
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
      warnings: ['制約ソルバーの求解に失敗しました'],
      targetOffDays,
      solverStatus: 'error',
    }
  }

  const status = solveResult.result.status
  if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) {
    if (process.env.SHIFT_SOLVER_DEBUG === '1') {
      console.warn(
        '[shift-solver-csp] infeasible diagnostics',
        buildInfeasibleDiagnostics({
          staff,
          dayMeta,
          minNight,
          requiredDayByIndex,
          personalTargetByStaff,
          fixedLeaveCodes,
          fixedOffDays,
          forcedAkeDays,
          carryInWorkDays,
          pairConstraints,
        }),
      )
    }
    return {
      grid,
      warnings: ['制約を同時に満たすシフトを生成できませんでした。夜勤人数・休日数・希望休の組み合わせを見直してください。'],
      targetOffDays,
      solverStatus: 'infeasible',
    }
  }

  const resultVars = solveResult.result.vars
  for (const member of staff) {
    const memberFixedLeaveCodes = fixedLeaveCodes.get(member.id)
    grid[member.id] = Array.from({ length: daysInMonth }, (_, dayIdx) =>
      codeFromResult(resultVars, member.id, dayIdx, memberFixedLeaveCodes),
    )
  }

  addWarnings({
    staff,
    grid,
    warnings,
    dayMeta,
    minNight,
    maxNight,
    maxDayByIndex,
    requiredDayByIndex,
    maxConsecutive,
    pairConstraints,
    personalTargetByStaff,
  })

  return { grid, warnings, targetOffDays, solverStatus: 'success' }
}
