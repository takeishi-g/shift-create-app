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
  /** スタッフIDごとの前月繰越日数 */
  carryOverByStaff?: Record<string, number>
  /** カスタム休日の日付文字列（'YYYY-MM-DD'[]）。isWeekend 判定に使用する */
  customHolidayDates?: string[]
}

export interface SolverOutput {
  grid: ShiftGrid
  warnings: string[]
  targetOffDays: number
  solverStatus: 'success' | 'infeasible' | 'error' | 'supply-error'
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

/**
 * ハード夜勤希望（pref_night）が、夜勤分散免除後も構造的に満たせないケースを
 * 生成前に検出し、具体名・具体日で警告する。「原因不明の infeasible」を防ぎ、
 * 利用者が希望日や設定をピンポイントで直せるようにする。
 */
function collectHardNightRequestWarnings(args: {
  staff: StaffProfile[]
  shiftPreferences: Map<string, Map<number, 'day' | 'night'>>
  fixedLeaveCodes: Map<string, Map<number, FixedLeaveCode>>
  fixedOffDays: Map<string, Set<number>>
  forcedAkeDays: Map<string, Set<number>>
  pairConstraints: StaffPairConstraint[]
  year: number
  month: number
  customHolidayDates: string[]
}): string[] {
  const { staff, shiftPreferences, fixedLeaveCodes, fixedOffDays, forcedAkeDays, pairConstraints, year, month, customHolidayDates } = args
  const warnings: string[] = []
  const holidaySet = new Set(customHolidayDates)
  const md = (dayIdx: number) => `${month}/${dayIdx + 1}`
  const nameById = new Map(staff.map((member) => [member.id, member.name]))
  const nightDaysByStaff = new Map<string, number[]>()

  for (const member of staff) {
    const prefs = shiftPreferences.get(member.id)
    if (!prefs) continue
    const nightDays = [...prefs.entries()].filter(([, v]) => v === 'night').map(([d]) => d).sort((a, b) => a - b)
    if (nightDays.length === 0) continue

    const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
    const memberFixed = fixedLeaveCodes.get(member.id)
    const memberOff = fixedOffDays.get(member.id) ?? new Set<number>()
    const memberAke = forcedAkeDays.get(member.id) ?? new Set<number>()

    // 希望日を「ソルバーが実際に夜勤固定する日（有効）」と「定休等で反映されない日」に分ける。
    // pref_night は dayAlreadyForced（定休/祝/休み希望/前月繰越明け）の日には適用されないため、
    // 上限・3連続・ペアの判定は有効な希望日のみで行う（無効日を数えると誤警告になる）。
    // 2. 希望日が定休/祝/休み希望/明けと重複 → そのまま反映できないので警告
    const effectiveNightDays: number[] = []
    for (const d of nightDays) {
      const date = new Date(year, month - 1, d + 1)
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`
      const isHoliday = HolidayJP.isHoliday(date) || holidaySet.has(dateStr)
      const blocked =
        hardOffDow.has(date.getDay()) ||
        (member.hard_off_on_holidays && isHoliday) ||
        memberFixed?.has(d) ||
        memberOff.has(d) ||
        memberAke.has(d)
      if (blocked) {
        warnings.push(`${member.name}さんの夜勤希望（${md(d)}）は定休日・休み希望・明けと重なるため反映できません。別の日にしてください。`)
      } else {
        effectiveNightDays.push(d)
      }
    }
    nightDaysByStaff.set(member.id, effectiveNightDays)

    // 1. 夜勤上限超過（有効な希望のみで判定）。night_cap ハード制約で infeasible になる
    if (effectiveNightDays.length > member.max_night_shifts) {
      warnings.push(`${member.name}さんの夜勤希望が ${effectiveNightDays.length} 件ありますが夜勤上限は ${member.max_night_shifts} 回です。上限を上げるか希望を ${member.max_night_shifts} 件以内にしてください。`)
    }

    // 3. 3連続夜勤（D・D+2・D+4 がすべて有効な夜勤希望）= 安全ルール max2_consecutive_night 違反。
    //    重複する連鎖を多重報告しないよう、検出した連鎖の末尾（d+4）まではスキップする。
    const daySet = new Set(effectiveNightDays)
    let reportedThrough = -1
    for (const d of effectiveNightDays) {
      if (d <= reportedThrough) continue
      if (daySet.has(d + 2) && daySet.has(d + 4)) {
        warnings.push(`${member.name}さんの夜勤希望（${md(d)}・${md(d + 2)}・${md(d + 4)}）は3連続夜勤になり許可できません。間隔を空けてください。`)
        reportedThrough = d + 4
      }
    }
  }

  // 4. 同日夜勤禁止ペアが同じ日に夜勤希望（衝突日はすべて報告）
  for (const pair of pairConstraints) {
    if (pair.constraint_type !== 'must_not_pair' || !pairTargetsNight(pair)) continue
    const aDays = nightDaysByStaff.get(pair.staff_id_a)
    const bDays = nightDaysByStaff.get(pair.staff_id_b)
    if (!aDays || !bDays) continue
    const bSet = new Set(bDays)
    const conflicts = aDays.filter((d) => bSet.has(d))
    if (conflicts.length === 0) continue
    const nameA = nameById.get(pair.staff_id_a) ?? pair.staff_id_a
    const nameB = nameById.get(pair.staff_id_b) ?? pair.staff_id_b
    for (const d of conflicts) {
      warnings.push(`ペア制約: ${md(d)} に ${nameA}さん・${nameB}さんが両方とも夜勤希望ですが、同日夜勤は禁止です。どちらかをずらしてください。`)
    }
  }

  return warnings
}

function buildDayMeta(
  year: number,
  month: number,
  daysInMonth: number,
  bathDayIndices: number[],
  customHolidayDates?: string[],
): DayMeta[] {
  const bathSet = new Set(bathDayIndices)
  const customHolidaySet = new Set(customHolidayDates ?? [])
  return Array.from({ length: daysInMonth }, (_, dayIdx) => {
    const date = new Date(year, month - 1, dayIdx + 1)
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
    return {
      isWeekend:
        date.getDay() === 0 ||
        date.getDay() === 6 ||
        HolidayJP.isHoliday(date) ||
        customHolidaySet.has(dateStr),
      isBathDay: bathSet.has(dayIdx),
    }
  })
}

function pairTargetsNight(pair: StaffPairConstraint): boolean {
  return pair.shift_type_id === null || pair.shift_type?.is_overnight === true
}

function pairTargetsDay(pair: StaffPairConstraint): boolean {
  return pair.shift_type_id === null || pair.shift_type?.is_overnight === false
}

function getShiftMinimums(
  constraints: ShiftConstraints | null,
  shiftTypes: ShiftType[] | undefined,
  dayMeta: DayMeta[],
  staffCount: number,
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
  const minDay = Number.isFinite(Number(minDayValue)) ? Number(minDayValue) : 5
  const maxNight = Number.isFinite(Number(maxNightValue)) ? Math.max(minNight, Number(maxNightValue)) : minNight
  // 平日の上限は明示設定がある場合のみ適用。未設定時はスタッフ数（実質無制限）にする。
  // min=max になると等式制約になりinfeasibleを引き起こすため。
  const maxDay = Number.isFinite(Number(maxDayValue)) ? Math.max(minDay, Number(maxDayValue)) : staffCount
  const minWeekend = constraints?.min_staff_weekend ?? 3
  const maxWeekend = constraints?.max_staff_weekend ?? 3
  const minBathDay = constraints?.min_staff_bath_day ?? minDay

  const requiredDayByIndex = dayMeta.map((meta) => {
    let required = meta.isWeekend ? minWeekend : minDay
    if (meta.isBathDay) required = Math.max(required, minBathDay)
    return required
  })

  const maxDayByIndex = dayMeta.map((meta) => (meta.isWeekend ? maxWeekend : maxDay))

  return { minNight, minDay, maxNight, maxDay, minWeekend, requiredDayByIndex, maxDayByIndex }
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

  // 日別違反を集約して1〜2行にまとめる（ペア制約と同形式）
  type DayViol = { day: number; actual: number; required: number }
  const nightShort: DayViol[] = []
  const nightOver: DayViol[] = []
  const dayShortWeekday: DayViol[] = []
  const dayShortWeekend: DayViol[] = []
  const dayOverWeekday: DayViol[] = []
  const dayOverWeekend: DayViol[] = []

  for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
    const nightCount = staff.filter((member) => grid[member.id][dayIdx] === '夜').length
    const dayCount   = staff.filter((member) => grid[member.id][dayIdx] === '日').length
    const isWE = dayMeta[dayIdx].isWeekend
    if (nightCount < minNight)                  nightShort.push({ day: dayIdx + 1, actual: nightCount, required: minNight })
    if (nightCount > maxNight)                  nightOver.push({ day: dayIdx + 1, actual: nightCount, required: maxNight })
    if (dayCount < requiredDayByIndex[dayIdx])  (isWE ? dayShortWeekend : dayShortWeekday).push({ day: dayIdx + 1, actual: dayCount, required: requiredDayByIndex[dayIdx] })
    if (dayCount > maxDayByIndex[dayIdx])       (isWE ? dayOverWeekend  : dayOverWeekday).push({ day: dayIdx + 1, actual: dayCount, required: maxDayByIndex[dayIdx] })
  }

  const fmtDays = (vs: DayViol[], max = 5) => {
    const days = vs.slice(0, max).map(v => `${v.day}日`).join('・')
    return vs.length > max ? `${days} 他${vs.length - max}日（計${vs.length}日）` : `${days}（計${vs.length}日）`
  }
  if (nightShort.length > 0)
    warnings.push(`夜勤が最低${nightShort[0].required}人に満たない日があります（${fmtDays(nightShort)}）。夜勤の最低人数を減らすか、スタッフの夜勤上限回数を増やしてください。`)
  if (nightOver.length > 0)
    warnings.push(`夜勤が上限${nightOver[0].required}人を超えた日があります（${fmtDays(nightOver)}）。夜勤の上限人数を増やすか、設定を見直してください。`)
  if (dayShortWeekday.length > 0)
    warnings.push(`平日の日勤が最低${dayShortWeekday[0].required}人に満たない日があります（${fmtDays(dayShortWeekday)}）。日勤の最低配置人数を減らすか、夜勤回数を調整してください。`)
  if (dayShortWeekend.length > 0)
    warnings.push(`土日祝の日勤が最低${dayShortWeekend[0].required}人に満たない日があります（${fmtDays(dayShortWeekend)}）。土日祝の最低配置人数を減らしてください。`)
  if (dayOverWeekday.length > 0)
    warnings.push(`平日の日勤が上限${dayOverWeekday[0].required}人を超えた日があります（${fmtDays(dayOverWeekday)}）。日勤の上限人数を増やすか、夜勤を増やしてください。`)
  if (dayOverWeekend.length > 0)
    warnings.push(`土日祝の日勤が上限${dayOverWeekend[0].required}人を超えた日があります（${fmtDays(dayOverWeekend)}）。土日祝の上限人数を増やしてください。`)

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

  const staffNameMap = new Map(staff.map((s) => [s.id, s.name]))
  for (const pair of pairConstraints) {
    const nameA = staffNameMap.get(pair.staff_id_a) ?? pair.staff_id_a
    const nameB = staffNameMap.get(pair.staff_id_b) ?? pair.staff_id_b
    for (let dayIdx = 0; dayIdx < dayMeta.length; dayIdx++) {
      const a = grid[pair.staff_id_a]?.[dayIdx]
      const b = grid[pair.staff_id_b]?.[dayIdx]
      if (pair.constraint_type === 'must_not_pair') {
        if (pairTargetsNight(pair) && a === '夜' && b === '夜') {
          warnings.push(`ペア制約: ${dayIdx + 1}日 ${nameA} / ${nameB} が同日夜勤です`)
        }
        if (pairTargetsDay(pair) && a === '日' && b === '日') {
          warnings.push(`ペア制約: ${dayIdx + 1}日 ${nameA} / ${nameB} が同日日勤です`)
        }
      } else {
        // must_pair: 平日のみチェック（土日祝は両者休み・夜・明でも問題なし）
        if (dayMeta[dayIdx].isWeekend) continue
        const ngSet = new Set<string>(['公', '夜', '明'])
        if (ngSet.has(a ?? '') && ngSet.has(b ?? '')) {
          warnings.push(`必ペア制約: ${dayIdx + 1}日 ${nameA} / ${nameB} の日勤カバーができていません（両者とも日勤外）`)
          break
        }
      }
    }
  }
}

function checkFeasibility(
  staff: StaffProfile[],
  minNight: number,
  daysInMonth: number,
  requiredDayByIndex: number[],
  dayMeta: DayMeta[],
): string[] {
  const issues: string[] = []

  // 夜勤供給チェック
  if (minNight > 0) {
    const required = daysInMonth * minNight
    const capacity = staff.reduce((sum, m) => sum + m.max_night_shifts, 0)
    if (capacity < required) {
      issues.push(
        `夜勤の回数が足りません（必要 ${required} 回・スタッフの夜勤上限合計 ${capacity} 回）。` +
        `スタッフの夜勤上限回数を増やすか、夜勤の最低人数を減らしてください。`,
      )
    }
  }

  // 日勤供給チェック（最悪ケース推定）
  // 夜勤minNight人 + 前日明けminNight人 が常に非日勤として、残りで最低人数を確保できるか
  const maxDayRequired = requiredDayByIndex.reduce((max, v) => Math.max(max, v), 0)
  const weekdayMaxRequired = requiredDayByIndex.filter((_, i) => !dayMeta[i].isWeekend).reduce((max, v) => Math.max(max, v), 0)
  const estimatedAvailable = staff.length - minNight * 2 // 夜勤+明けを除く大まかな推定
  if (weekdayMaxRequired > 0 && estimatedAvailable < weekdayMaxRequired) {
    issues.push(
      `平日の日勤最低人数 ${weekdayMaxRequired} 人を確保できない日がある可能性があります` +
      `（スタッフ ${staff.length} 人・夜勤 ${minNight} 人・明け ${minNight} 人を除くと最大 ${estimatedAvailable} 人）。` +
      `日勤の最低人数を減らすか、夜勤の最低人数を減らしてください。`,
    )
  }

  return issues
}

/**
 * Pass 1: シニアスタッフ（師長・主任）のみで LP を解き、最適な夜勤配置を先に確定する。
 * senior_day_coverage（平日に必ず1名以上が日勤）をハード制約として満たしながら、
 * isHardOffDay の定休日前夜勤誘導（dayIdx-2）を最大限に活かす。
 * 解が得られれば ShiftGrid を返し、失敗時は null（メインパスがシングルパスにフォールバック）。
 */
function solveSeniorFirstPass(
  glpk: GLPK,
  yearMonth: string,
  seniorStaff: StaffProfile[],
  daysInMonth: number,
  year: number,
  month: number,
  dayMeta: DayMeta[],
  forcedAkeDays: Map<string, Set<number>>,
  fixedOffDays: Map<string, Set<number>>,
  fixedLeaveCodes: Map<string, Map<number, FixedLeaveCode>>,
  shiftPreferences: Map<string, Map<number, 'day' | 'night'>>,
  personalTargetByStaff: Map<string, number>,
  nightTargetByStaff: Map<string, number>,
  maxConsecutive: number,
  carryInWorkDays: Map<string, number>,
): ShiftGrid | null {
  if (seniorStaff.length === 0) return null

  const s1ObjectiveVars: LP['objective']['vars'] = []
  const s1SubjectTo: LP['subjectTo'] = []
  const s1Bounds: NonNullable<LP['bounds']> = []
  const s1Binaries: string[] = []

  const addBinary = (name: string) => {
    s1Binaries.push(name)
    s1Bounds.push({ name, type: glpk.GLP_DB, lb: 0, ub: 1 })
  }
  const addContinuous = (name: string) => {
    s1Bounds.push({ name, type: glpk.GLP_LO, lb: 0, ub: 0 })
  }
  const addObjective = (name: string, coef: number) => {
    s1ObjectiveVars.push({ name, coef })
  }
  const addRow = (name: string, vars: LP['subjectTo'][number]['vars'], type: number, lb: number, ub = 0) => {
    s1SubjectTo.push({ name, vars, bnds: { type, lb, ub } })
  }

  // 変数宣言
  for (const member of seniorStaff) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      addBinary(varName('n', member.id, dayIdx))
      addBinary(varName('w', member.id, dayIdx))
      addBinary(varName('a', member.id, dayIdx))
      addBinary(varName('o', member.id, dayIdx))
    }
  }

  for (const member of seniorStaff) {
    const memberFixedLeaves = fixedLeaveCodes.get(member.id)
    const memberPrefs = shiftPreferences.get(member.id)
    const memberForcedAke = forcedAkeDays.get(member.id) ?? new Set<number>()
    const memberFixedOff = fixedOffDays.get(member.id) ?? new Set<number>()
    const carryInWork = carryInWorkDays.get(member.id) ?? 0
    const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
    const softOffDow = new Set(member.soft_off_days_of_week ?? [])

    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const n = varName('n', member.id, dayIdx)
      const w = varName('w', member.id, dayIdx)
      const a = varName('a', member.id, dayIdx)
      const o = varName('o', member.id, dayIdx)

      addRow(
        `s1_onehot__${member.id}__${dayIdx}`,
        [{ name: n, coef: 1 }, { name: w, coef: 1 }, { name: a, coef: 1 }, { name: o, coef: 1 }],
        glpk.GLP_FX, 1, 1,
      )

      const date = new Date(year, month - 1, dayIdx + 1)
      const isHoliday = HolidayJP.isHoliday(date)
      const pref = memberPrefs?.get(dayIdx)
      const isHardOffDay = hardOffDow.has(date.getDay()) || (member.hard_off_on_holidays && isHoliday)
      const isSoftOffDay =
        !isHardOffDay && (softOffDow.has(date.getDay()) || (member.soft_off_on_holidays && isHoliday))

      const s1DayAlreadyForced = memberFixedLeaves?.has(dayIdx) || memberFixedOff.has(dayIdx) || isHardOffDay || memberForcedAke.has(dayIdx)
      if (pref === 'night' && !s1DayAlreadyForced) addRow(`s1_pref_night__${member.id}__${dayIdx}`, [{ name: n, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (pref === 'day' && !s1DayAlreadyForced) addRow(`s1_pref_day__${member.id}__${dayIdx}`, [{ name: w, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (memberForcedAke.has(dayIdx)) addRow(`s1_forced_ake__${member.id}__${dayIdx}`, [{ name: a, coef: 1 }], glpk.GLP_FX, 1, 1)

      const prevDayHardOff = dayIdx > 0 ? (() => {
        const pd = new Date(year, month - 1, dayIdx)
        return hardOffDow.has(pd.getDay()) || (member.hard_off_on_holidays && HolidayJP.isHoliday(pd))
      })() : false
      const prevDayForcedOff = dayIdx > 0 && (
        memberFixedLeaves?.has(dayIdx - 1) === true ||
        memberFixedOff.has(dayIdx - 1) ||
        prevDayHardOff
      )

      if (memberFixedLeaves?.has(dayIdx) || memberFixedOff.has(dayIdx) || isHardOffDay) {
        addRow(`s1_forced_off__${member.id}__${dayIdx}`, [{ name: o, coef: 1 }], glpk.GLP_FX, 1, 1)
        // ハード定休日 D: 正しいパターン 夜(D-2)→明(D-1)→定休(D)
        if (isHardOffDay && member.max_night_shifts > 0 && dayIdx >= 2 && !prevDayForcedOff) {
          addObjective(varName('n', member.id, dayIdx - 2), -15)
        }
      } else if (isSoftOffDay) {
        addObjective(varName('n', member.id, dayIdx), 3)
        addObjective(varName('w', member.id, dayIdx), 3)
        const prevDaySoftOff = dayIdx > 0 ? (() => {
          const pd = new Date(year, month - 1, dayIdx)
          const pdHoliday = HolidayJP.isHoliday(pd)
          return softOffDow.has(pd.getDay()) || (member.soft_off_on_holidays && pdHoliday)
        })() : false
        if (member.max_night_shifts > 0 && dayIdx >= 1 && !prevDayForcedOff && !prevDaySoftOff) {
          // シニアのsoft定休日: 弱め誘導（senior_day_coverage との競合を考慮）
          addObjective(varName('n', member.id, dayIdx - 1), -1)
        }
      }

      // 土日祝の連休初日に対する汎用夜勤誘導
      if (
        dayMeta[dayIdx].isWeekend &&
        !isHardOffDay &&
        member.max_night_shifts > 0 &&
        dayIdx >= 1 &&
        !dayMeta[dayIdx - 1].isWeekend
      ) {
        addObjective(varName('n', member.id, dayIdx - 1), -1)
      }

      if (dayIdx === 0) {
        const forcedAke = memberForcedAke.has(dayIdx) ? 1 : 0
        addRow(`s1_ake_origin__${member.id}__${dayIdx}`, [{ name: a, coef: 1 }], glpk.GLP_FX, forcedAke, forcedAke)
      } else {
        addRow(
          `s1_ake_origin__${member.id}__${dayIdx}`,
          [{ name: a, coef: 1 }, { name: varName('n', member.id, dayIdx - 1), coef: -1 }],
          glpk.GLP_FX, 0, 0,
        )
      }

      if (dayIdx + 2 < daysInMonth) {
        addRow(
          `s1_post_night_off__${member.id}__${dayIdx}`,
          [
            { name: varName('o', member.id, dayIdx + 2), coef: 1 },
            { name: varName('n', member.id, dayIdx + 2), coef: 1 },
            { name: n, coef: -1 },
          ],
          glpk.GLP_LO, 0, 0,
        )
      }
    }

    // 翌月冒頭のハード定休日に対する夜勤誘導（月末D-2パターンが月をまたぐ場合）
    if (member.max_night_shifts > 0) {
      for (let nextOffset = 1; nextOffset <= 2; nextOffset++) {
        const nextDate = new Date(year, month - 1, daysInMonth + nextOffset)
        const isNextHardOff = hardOffDow.has(nextDate.getDay()) ||
          (member.hard_off_on_holidays && HolidayJP.isHoliday(nextDate))
        if (!isNextHardOff) continue
        const prevDate = new Date(year, month - 1, daysInMonth + nextOffset - 1)
        const prevIsHardOff = hardOffDow.has(prevDate.getDay()) ||
          (member.hard_off_on_holidays && HolidayJP.isHoliday(prevDate))
        if (prevIsHardOff) continue  // 連続定休の初日のみ誘導
        const targetDayIdx = daysInMonth + nextOffset - 3  // D-2
        if (targetDayIdx >= 0) {
          addObjective(varName('n', member.id, targetDayIdx), -15)
        }
      }
    }

    // 夜勤間隔制約（5回以下は連続夜勤禁止）
    // 定休スタッフ（曜日定休 or 祝日定休あり）は均等化を免除する。均等化は公平性ルールであり
    // 安全ルールではない（CONSTRAINTS.md §7 の制約優先度表に存在しない実装ヒューリスティック）。
    // 定休誘導(-15)が自動夜勤を定休の2日前へ寄せるのを均等化が阻むため、定休スタッフだけ外す。
    if (
      member.max_night_shifts >= 1 &&
      member.max_night_shifts <= 5 &&
      !(hardOffDow.size > 0 || member.hard_off_on_holidays)
    ) {
      const minGap = Math.max(3, Math.floor(daysInMonth / member.max_night_shifts) - 1)
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        for (let k = 2; k <= minGap && dayIdx + k < daysInMonth; k++) {
          // 夜勤分散（均等化）は、両端とも夜勤希望日のときだけ適用しない（本パスと同じ方針）
          if (memberPrefs?.get(dayIdx) === 'night' && memberPrefs?.get(dayIdx + k) === 'night') continue
          addRow(
            `s1_night_spacing__${member.id}__${dayIdx}__${k}`,
            [
              { name: varName('n', member.id, dayIdx), coef: 1 },
              { name: varName('n', member.id, dayIdx + k), coef: 1 },
            ],
            glpk.GLP_UP, 0, 1,
          )
        }
      }
    }

    // 3連続夜勤禁止
    for (let dayIdx = 0; dayIdx + 4 < daysInMonth; dayIdx++) {
      addRow(
        `s1_max2_consecutive_night__${member.id}__${dayIdx}`,
        [
          { name: varName('n', member.id, dayIdx), coef: 1 },
          { name: varName('n', member.id, dayIdx + 2), coef: 1 },
          { name: varName('n', member.id, dayIdx + 4), coef: 1 },
        ],
        glpk.GLP_UP, 0, 2,
      )
    }

    // 2連続夜勤後は2日公休
    for (let dayIdx = 0; dayIdx + 5 < daysInMonth; dayIdx++) {
      addRow(
        `s1_double_night_second_off__${member.id}__${dayIdx}`,
        [
          { name: varName('o', member.id, dayIdx + 5), coef: 1 },
          { name: varName('n', member.id, dayIdx), coef: -1 },
          { name: varName('n', member.id, dayIdx + 2), coef: -1 },
        ],
        glpk.GLP_LO, -1, 0,
      )
    }

    // 夜勤上限
    addRow(
      `s1_night_cap__${member.id}`,
      Array.from({ length: daysInMonth }, (_, dayIdx) => ({
        name: varName('n', member.id, dayIdx), coef: 1,
      })),
      glpk.GLP_UP, 0, member.max_night_shifts,
    )

    // 連続勤務上限
    for (let start = 0; start + maxConsecutive < daysInMonth; start++) {
      const vars: LP['subjectTo'][number]['vars'] = []
      for (let dayIdx = start; dayIdx <= start + maxConsecutive; dayIdx++) {
        vars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
        vars.push({ name: varName('w', member.id, dayIdx), coef: 1 })
      }
      addRow(`s1_consecutive__${member.id}__${start}`, vars, glpk.GLP_UP, 0, maxConsecutive)
    }

    // 前月繰越連勤の保護
    if (carryInWork > 0) {
      const protectedPrefixLength = Math.min(daysInMonth, Math.max(1, maxConsecutive - carryInWork + 1))
      const vars: LP['subjectTo'][number]['vars'] = []
      for (let dayIdx = 0; dayIdx < protectedPrefixLength; dayIdx++) {
        vars.push({ name: varName('n', member.id, dayIdx), coef: 1 })
        vars.push({ name: varName('w', member.id, dayIdx), coef: 1 })
      }
      addRow(
        `s1_carry_in_consecutive__${member.id}`,
        vars, glpk.GLP_UP, 0, Math.max(0, maxConsecutive - carryInWork),
      )
    }

    // 公休目標（ソフトペナルティ）
    const offPos = `s1_off_pos__${member.id}`
    const offNeg = `s1_off_neg__${member.id}`
    addContinuous(offPos)
    addContinuous(offNeg)
    addObjective(offPos, 10)
    addObjective(offNeg, 10)
    addRow(
      `s1_off_target__${member.id}`,
      [
        { name: offPos, coef: -1 },
        { name: offNeg, coef: 1 },
        ...Array.from({ length: daysInMonth }, (_, dayIdx) => ({
          name: varName('o', member.id, dayIdx), coef: 1,
        })),
      ],
      glpk.GLP_FX,
      personalTargetByStaff.get(member.id) ?? 0,
      personalTargetByStaff.get(member.id) ?? 0,
    )

    // 夜勤目標（ソフトペナルティ）
    const nightPos = `s1_night_pos__${member.id}`
    const nightNeg = `s1_night_neg__${member.id}`
    addContinuous(nightPos)
    addContinuous(nightNeg)
    addObjective(nightPos, 5)
    addObjective(nightNeg, 5)
    addRow(
      `s1_night_target__${member.id}`,
      [
        { name: nightPos, coef: -1 },
        { name: nightNeg, coef: 1 },
        ...Array.from({ length: daysInMonth }, (_, dayIdx) => ({
          name: varName('n', member.id, dayIdx), coef: 1,
        })),
      ],
      glpk.GLP_FX,
      nightTargetByStaff.get(member.id) ?? 0,
      nightTargetByStaff.get(member.id) ?? 0,
    )
  }

  // シニア間の相互カバレッジ: 平日は必ず1名以上が日勤
  // 前月繰越明け・希望休等で全シニアが強制不在の日はスキップ（pass2でwarning）
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    if (dayMeta[dayIdx].isWeekend) continue
    const allSeniorsForced = seniorStaff.every(m => {
      const mForcedAke = forcedAkeDays.get(m.id) ?? new Set<number>()
      const mFixedOff = fixedOffDays.get(m.id) ?? new Set<number>()
      const mLeaves = fixedLeaveCodes.get(m.id)
      const date = new Date(year, month - 1, dayIdx + 1)
      const isHol = HolidayJP.isHoliday(date)
      const hardDow = new Set(m.hard_off_days_of_week ?? [])
      const isHardOff = hardDow.has(date.getDay()) || (m.hard_off_on_holidays && isHol)
      return mForcedAke.has(dayIdx) || (mLeaves?.has(dayIdx) ?? false) || mFixedOff.has(dayIdx) || isHardOff
    })
    if (allSeniorsForced) continue
    addRow(
      `s1_senior_coverage__${dayIdx}`,
      seniorStaff.map((m) => ({ name: varName('w', m.id, dayIdx), coef: 1 })),
      glpk.GLP_LO, 1, 0,
    )
  }

  const s1Lp: LP = {
    name: `shift_senior_pass1_${yearMonth}`,
    objective: { direction: glpk.GLP_MIN, name: 'penalty', vars: s1ObjectiveVars },
    subjectTo: s1SubjectTo,
    bounds: s1Bounds,
    binaries: s1Binaries,
  }

  let s1Result: Awaited<ReturnType<GLPK['solve']>>
  try {
    s1Result = glpk.solve(s1Lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: 10 })
  } catch {
    return null
  }

  if (s1Result.result.status !== glpk.GLP_OPT && s1Result.result.status !== glpk.GLP_FEAS) {
    return null
  }

  const seniorGrid: ShiftGrid = {}
  for (const member of seniorStaff) {
    const memberFixedLeaveCodes = fixedLeaveCodes.get(member.id)
    seniorGrid[member.id] = Array.from({ length: daysInMonth }, (_, dayIdx) =>
      codeFromResult(s1Result.result.vars, member.id, dayIdx, memberFixedLeaveCodes),
    )
  }
  return seniorGrid
}

export async function generateShifts(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, shiftTypes, bathDayIndices, prevMonthTail, customHolidayDates } = input
  const warnings: string[] = []

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const grid = emptyGrid(staff, daysInMonth)
  const dayMeta = buildDayMeta(year, month, daysInMonth, bathDayIndices, customHolidayDates)
  const targetOffDays = constraints?.target_off_days ?? dayMeta.filter(d => d.isWeekend).length
  const { forcedAkeDays, fixedOffDays, carryInWorkDays } = buildPrevMonthInfo(staff, prevMonthTail, daysInMonth)
  const { fixedLeaveCodes, shiftPreferences, paidLeaveCount } = buildFixedLeaveData(leaveRequests, year, month)
  // 夜勤希望（ハード）が構造的に満たせないケースを生成前に具体名で警告する。
  // 全 return パスに含めるため独立変数で保持する（infeasible 時こそ原因提示が重要）。
  const nightRequestWarnings = collectHardNightRequestWarnings({
    staff, shiftPreferences, fixedLeaveCodes, fixedOffDays, forcedAkeDays,
    pairConstraints, year, month, customHolidayDates: customHolidayDates ?? [],
  })
  const { minNight, maxNight, minWeekend, requiredDayByIndex, maxDayByIndex } = getShiftMinimums(constraints, shiftTypes, dayMeta, staff.length)
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const carryOverByStaff = input.carryOverByStaff ?? {}
  const personalTargetByStaff = new Map<string, number>(
    staff.map((member) => {
      const paidLeaves = paidLeaveCount.get(member.id) ?? 0
      const carryOver = carryOverByStaff[member.id] ?? 0
      if (!member.allow_extra_off_days) {
        const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
        const softOffDow = new Set(member.soft_off_days_of_week ?? [])
        const customHolidaySet = new Set(customHolidayDates ?? [])
        const definedOffCount = Array.from({ length: daysInMonth }, (_, dayIdx) => {
          const date = new Date(year, month - 1, dayIdx + 1)
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
          const isHoliday = HolidayJP.isHoliday(date) || customHolidaySet.has(dateStr)
          return (
            hardOffDow.has(date.getDay()) ||
            softOffDow.has(date.getDay()) ||
            (member.hard_off_on_holidays && isHoliday) ||
            (member.soft_off_on_holidays && isHoliday)
          )
        }).filter(Boolean).length
        return [member.id, definedOffCount + paidLeaves + carryOver]
      }
      return [member.id, targetOffDays + paidLeaves + carryOver]
    }),
  )

  // 事前フィージビリティチェック：明らかに解けない場合を先に検出してわかりやすく伝える
  const feasibilityIssues = checkFeasibility(staff, minNight, daysInMonth, requiredDayByIndex, dayMeta)
  if (feasibilityIssues.length > 0) {
    return {
      grid,
      warnings: [...nightRequestWarnings, ...feasibilityIssues],
      targetOffDays,
      solverStatus: 'supply-error',
    }
  }

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

  // Pass 1: シニアの夜勤配置を先に確定（2パス方式）
  // senior_day_coverage ハード制約をシニア同士で先に満たし、isHardOffDay 夜勤誘導を最大化する
  const seniorStaffForPass1 = staff.filter((m) => m.role === '師長' || m.role === '主任')
  const frozenSeniorGrid: ShiftGrid | null = seniorStaffForPass1.length >= 2
    ? solveSeniorFirstPass(
        glpk, yearMonth, seniorStaffForPass1, daysInMonth, year, month, dayMeta,
        forcedAkeDays, fixedOffDays, fixedLeaveCodes, shiftPreferences,
        personalTargetByStaff, nightTargetByStaff, maxConsecutive, carryInWorkDays,
      )
    : null


  // 平日日勤のターゲット人数を推定（分散目的関数用）
  // 総日勤シフト数 = 総就業日数 - 夜勤日数 - 明け日数
  const totalWorkDays = staff.reduce((sum, member) => {
    return sum + daysInMonth - (personalTargetByStaff.get(member.id) ?? targetOffDays)
  }, 0)
  const totalNightDays = staff.reduce((sum, member) => {
    return sum + (nightTargetByStaff.get(member.id) ?? 0)
  }, 0)
  const totalDayShifts = Math.max(0, totalWorkDays - 2 * totalNightDays)
  const weekendCount = dayMeta.filter((d) => d.isWeekend).length
  const weekdayCount = daysInMonth - weekendCount
  const weekdayDayShifts = Math.max(0, totalDayShifts - weekendCount * minWeekend)
  const targetDayPerWeekday = weekdayCount > 0 ? Math.round(weekdayDayShifts / weekdayCount) : 0

  for (const member of staff) {
    const memberFixedLeaves = fixedLeaveCodes.get(member.id)
    const memberPrefs = shiftPreferences.get(member.id)
    const memberForcedAke = forcedAkeDays.get(member.id) ?? new Set<number>()
    const memberFixedOff = fixedOffDays.get(member.id) ?? new Set<number>()
    const carryInWork = carryInWorkDays.get(member.id) ?? 0
    const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
    const softOffDow = new Set(member.soft_off_days_of_week ?? [])
    // Pass 2: pass 1 の夜勤配置を強力なソフト誘導として反映
    // ハード固定（GLP_FX）は非シニアの min/max_night 等式制約と干渉して infeasible を引き起こすため、
    // 目的関数の大きな負係数で誘導し、通常の全制約はそのまま適用する
    const pass1NightDays = frozenSeniorGrid?.[member.id]
    if (pass1NightDays) {
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        if (pass1NightDays[dayIdx] === '夜') {
          addObjective(varName('n', member.id, dayIdx), -100)
        }
      }
    }

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
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
      const isHoliday = HolidayJP.isHoliday(date) || (customHolidayDates ?? []).includes(dateStr)
      const pref = memberPrefs?.get(dayIdx)
      const isHardOffDay =
        hardOffDow.has(date.getDay()) || (member.hard_off_on_holidays && isHoliday)
      const isSoftOffDay =
        !isHardOffDay &&
        (softOffDow.has(date.getDay()) || (member.soft_off_on_holidays && isHoliday))

      const dayAlreadyForced = memberFixedLeaves?.has(dayIdx) || memberFixedOff.has(dayIdx) || isHardOffDay || memberForcedAke.has(dayIdx)
      if (pref === 'night' && !dayAlreadyForced) addRow(`pref_night__${member.id}__${dayIdx}`, [{ name: n, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (pref === 'day' && !dayAlreadyForced) addRow(`pref_day__${member.id}__${dayIdx}`, [{ name: w, coef: 1 }], glpk.GLP_FX, 1, 1)
      if (memberForcedAke.has(dayIdx)) addRow(`forced_ake__${member.id}__${dayIdx}`, [{ name: a, coef: 1 }], glpk.GLP_FX, 1, 1)
      const isDefinedOffDay =
        hardOffDow.has(date.getDay()) ||
        softOffDow.has(date.getDay()) ||
        (member.hard_off_on_holidays && isHoliday) ||
        (member.soft_off_on_holidays && isHoliday)
      const isSenior = member.role === '師長' || member.role === '主任'

      // 前日（dayIdx-1）も hard定休（forced_off になる）かどうかを判定するヘルパー値。
      // 連続公休（定休が連続する）の初日にのみ夜勤誘導を発動させるために使用する。
      // 「連休の2日目以降」から D-2 への誘導は:
      //   - 2日目（D）の場合: D-2 = 初日の前日、かつ初日が forced_off なら
      //     ake_origin 制約により n[D-2] = a[D-1] = ... となり、n[D-2] が夜勤不可になる場合が多い
      //   - また連休各日から重複して同じ変数に負の係数が累積するのを防ぐ
      const prevDayHardOff = dayIdx > 0 ? (() => {
        const pd = new Date(year, month - 1, dayIdx)
        const pdStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx).padStart(2, '0')}`
        return hardOffDow.has(pd.getDay()) || (member.hard_off_on_holidays && (HolidayJP.isHoliday(pd) || (customHolidayDates ?? []).includes(pdStr)))
      })() : false
      const prevDayForcedOff = dayIdx > 0 && (
        memberFixedLeaves?.has(dayIdx - 1) === true ||
        memberFixedOff.has(dayIdx - 1) ||
        prevDayHardOff
      )

      if (memberFixedLeaves?.has(dayIdx) || memberFixedOff.has(dayIdx) || isHardOffDay) {
        addRow(`forced_off__${member.id}__${dayIdx}`, [{ name: o, coef: 1 }], glpk.GLP_FX, 1, 1)
        // 「連続定休の初日」にのみ誘導する: 前日も forced_off なら重複誘導を防ぐ。
        // ハード定休日 D は forced_off により o[D]=1 → a[D]=0 → n[D-1]=0 が強制される。
        // そのため n[D-1] への誘導は無効。正しいパターン: 夜（D-2）→ 明（D-1）→ 定休（D）
        // D-2 に夜勤を置けば D-1 が明け、D の定休日が post_night_off と重なり公休節約になる。
        if (isHardOffDay && member.max_night_shifts > 0 && dayIdx >= 2 && !prevDayForcedOff) {
          // シニアも非シニアも同係数: senior_day_coverage はハード制約なので
          // 別シニアがカバーできない日はソルバーが自動的に D-2 夜勤を回避する
          addObjective(varName('n', member.id, dayIdx - 2), -15)
        }
      } else if (isSoftOffDay) {
        // soft定休日: 出勤時にペナルティ（強制ではないが優先的に休みを入れる）
        addObjective(varName('n', member.id, dayIdx), 3)
        addObjective(varName('w', member.id, dayIdx), 3)
        // 定休日X の2日前に夜勤を誘導: 夜（X-2）→ 明（X-1）→ 公（X=ソフト定休日）
        // 連続soft定休の初日のみ誘導（重複誘導防止）
        const prevDaySoftOff = dayIdx > 0 ? (() => {
          const pd = new Date(year, month - 1, dayIdx)
          const pdStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx).padStart(2, '0')}`
          const pdHoliday = HolidayJP.isHoliday(pd) || (customHolidayDates ?? []).includes(pdStr)
          return softOffDow.has(pd.getDay()) || (member.soft_off_on_holidays && pdHoliday)
        })() : false
        if (member.max_night_shifts > 0 && dayIdx >= 2 && !prevDayForcedOff && !prevDaySoftOff) {
          const prevPrevDate = new Date(year, month - 1, dayIdx - 1)
          const prevPrevDateStr2 = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx - 1).padStart(2, '0')}`
          const prevPrevDayForcedOff =
            memberFixedLeaves?.has(dayIdx - 2) === true ||
            memberFixedOff.has(dayIdx - 2) ||
            hardOffDow.has(prevPrevDate.getDay()) ||
            (member.hard_off_on_holidays && (HolidayJP.isHoliday(prevPrevDate) || (customHolidayDates ?? []).includes(prevPrevDateStr2)))
          if (!prevPrevDayForcedOff) {
            if (!isSenior) {
              addObjective(varName('n', member.id, dayIdx - 2), -3)
            } else {
              // シニア: 弱め誘導
              addObjective(varName('n', member.id, dayIdx - 2), -1)
            }
          }
        }
      } else if (!member.allow_extra_off_days && !isDefinedOffDay && !isHoliday) {
        // 定休日以外に公休を入れない
        // 祝日は除外: 祝日前後で6連勤になり infeasible になるため、solver に判断を委ねる
        if (member.max_night_shifts > 0 && dayIdx >= 2) {
          // 夜勤スタッフ: post_night_off（夜勤の2日後）のみ公休を許可
          // o[dayIdx] <= n[dayIdx-2]
          addRow(
            `no_extra_off_night__${member.id}__${dayIdx}`,
            [{ name: varName('n', member.id, dayIdx - 2), coef: 1 }, { name: o, coef: -1 }],
            glpk.GLP_LO, 0, 0,
          )
        } else {
          addRow(`no_extra_off__${member.id}__${dayIdx}`, [{ name: o, coef: 1 }], glpk.GLP_FX, 0, 0)
        }
      }

      // 土日祝（isWeekend）の連休初日に対する汎用夜勤誘導:
      // isHardOffDay / isSoftOffDay に基づく個人定休誘導が発動しない場合でも、
      // 土日祝の公休に夜勤パターン（夜→明→公）を重ねることで公休日数を節約できる。
      // 夜（D-2）→ 明（D-1）→ 公（D=連休初日）のパターンで公を連休初日に重ねる。
      // 条件:
      //   - 当日が土日祝（isWeekend）かつ前日が土日祝でない（連休の初日）
      //   - D-2 も土日祝でない（夜勤を置ける平日）
      //   - 夜勤可能・dayIdx >= 2
      //   - isHardOffDay の個人定休誘導と重複しない（isHardOffDay の場合は上で処理済み）
      if (
        dayMeta[dayIdx].isWeekend &&
        !isHardOffDay &&
        member.max_night_shifts > 0 &&
        dayIdx >= 2 &&
        !dayMeta[dayIdx - 1].isWeekend &&  // 連休の初日のみ（前日が土日祝でない）
        !dayMeta[dayIdx - 2].isWeekend     // D-2 も平日（夜勤を置ける）
      ) {
        if (!isSenior) {
          addObjective(varName('n', member.id, dayIdx - 2), -2)  // 個人定休誘導(-3)より弱めに設定
        } else {
          // シニア: senior_day_coverage との競合を避けるためさらに弱め誘導
          addObjective(varName('n', member.id, dayIdx - 2), -1)
        }
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
        // 2連続夜勤サポート: D+2が公 or 夜のどちらでもよい
        addRow(
          `post_night_off__${member.id}__${dayIdx}`,
          [
            { name: varName('o', member.id, dayIdx + 2), coef: 1 },
            { name: varName('n', member.id, dayIdx + 2), coef: 1 },
            { name: n, coef: -1 },
          ],
          glpk.GLP_LO,
          0,
          0,
        )
      }
    }

    // 翌月冒頭のハード定休日に対する夜勤誘導（月末D-2パターンが月をまたぐ場合）
    if (member.max_night_shifts > 0) {
      for (let nextOffset = 1; nextOffset <= 2; nextOffset++) {
        const nextDate = new Date(year, month - 1, daysInMonth + nextOffset)
        const isNextHardOff = hardOffDow.has(nextDate.getDay()) ||
          (member.hard_off_on_holidays && HolidayJP.isHoliday(nextDate))
        if (!isNextHardOff) continue
        const prevDate = new Date(year, month - 1, daysInMonth + nextOffset - 1)
        const prevIsHardOff = hardOffDow.has(prevDate.getDay()) ||
          (member.hard_off_on_holidays && HolidayJP.isHoliday(prevDate))
        if (prevIsHardOff) continue  // 連続定休の初日のみ誘導
        const targetDayIdx = daysInMonth + nextOffset - 3  // D-2
        if (targetDayIdx >= 0) {
          addObjective(varName('n', member.id, targetDayIdx), -15)
        }
      }
    }

    // 夜勤分散: 夜勤回数が少ないスタッフは最小間隔を設けて均等化
    // minGap = floor(daysInMonth / max_night_shifts) - 1（最低3）
    // n[D] + n[D+k] <= 1 for k in [2, minGap]（5回以下は連続夜勤も禁止）
    // 定休スタッフは均等化を免除（Pass1 と同方針）。定休誘導(-15)で夜勤を定休隣接へ寄せ、
    // post_night_off の公休が定休と重なり余分な公休を出さない（CONSTRAINTS.md §5）。
    if (
      member.max_night_shifts >= 1 &&
      member.max_night_shifts <= 5 &&
      !(hardOffDow.size > 0 || member.hard_off_on_holidays)
    ) {
      const minGap = Math.max(3, Math.floor(daysInMonth / member.max_night_shifts) - 1)
      // 5回以下は連続夜勤禁止（k=2から）= 週1ペース・単独夜勤のみ
      const startK = 2
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        for (let k = startK; k <= minGap && dayIdx + k < daysInMonth; k++) {
          // 夜勤分散（均等化）は、両端とも本人の夜勤希望日のときだけ適用しない。
          // infeasible を起こすのは pref_night で両端が1に固定される行のみなので、
          // その行だけ外せば必要十分。片端のみ希望の行は残し、枝刈り（求解速度）を維持する。
          // これは公平性ルールであり安全ルールではない（3連続夜勤禁止・明け公休・上限・ペア禁止は別制約で維持）。
          if (memberPrefs?.get(dayIdx) === 'night' && memberPrefs?.get(dayIdx + k) === 'night') continue
          addRow(
            `night_spacing__${member.id}__${dayIdx}__${k}`,
            [
              { name: varName('n', member.id, dayIdx),     coef: 1 },
              { name: varName('n', member.id, dayIdx + k), coef: 1 },
            ],
            glpk.GLP_UP,
            0,
            1,
          )
        }
      }
    }

    // 3連続夜勤禁止: n[D] + n[D+2] + n[D+4] <= 2
    for (let dayIdx = 0; dayIdx + 4 < daysInMonth; dayIdx++) {
      addRow(
        `max2_consecutive_night__${member.id}__${dayIdx}`,
        [
          { name: varName('n', member.id, dayIdx),     coef: 1 },
          { name: varName('n', member.id, dayIdx + 2), coef: 1 },
          { name: varName('n', member.id, dayIdx + 4), coef: 1 },
        ],
        glpk.GLP_UP,
        0,
        2,
      )
    }

    // 2連続夜勤後は2日公休: o[D+5] >= n[D] + n[D+2] - 1
    for (let dayIdx = 0; dayIdx + 5 < daysInMonth; dayIdx++) {
      addRow(
        `double_night_second_off__${member.id}__${dayIdx}`,
        [
          { name: varName('o', member.id, dayIdx + 5), coef: 1 },
          { name: varName('n', member.id, dayIdx),     coef: -1 },
          { name: varName('n', member.id, dayIdx + 2), coef: -1 },
        ],
        glpk.GLP_LO,
        -1,
        0,
      )
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

    // 高夜勤スタッフ（6回以上）の3分割ハードバランス: 各ゾーンの上限をceil(target/3)に制限
    // 連続夜勤パターン（夜→明→夜→明→公→公）は維持しつつ、ゾーン内集中を防ぐ
    if (member.max_night_shifts > 5) {
      const memberNightTarget = nightTargetByStaff.get(member.id) ?? 0
      if (memberNightTarget > 0) {
        const zoneSize = Math.floor(daysInMonth / 3)
        const zoneBounds = [
          { start: 0,            end: zoneSize },
          { start: zoneSize,     end: zoneSize * 2 },
          { start: zoneSize * 2, end: daysInMonth },
        ]
        for (let z = 0; z < zoneBounds.length; z++) {
          const { start, end } = zoneBounds[z]
          const zoneLen = end - start
          // 各ゾーンの上限: ceil(target × zoneLen / daysInMonth)
          // 下限: floor(target × zoneLen / daysInMonth)（0未満にならないよう保護）
          const exactTarget = memberNightTarget * zoneLen / daysInMonth
          const minInZone = Math.max(0, Math.floor(exactTarget))
          const maxInZone = Math.ceil(exactTarget)
          addRow(
            `night_zone_hard__${member.id}__${z}`,
            Array.from({ length: zoneLen }, (_, d) => ({
              name: varName('n', member.id, start + d),
              coef: 1,
            })),
            glpk.GLP_DB,
            minInZone,
            maxInZone,
          )
        }
      }

      // 2連続夜勤（夜明夜明）を報酬: 回数が多いスタッフ（max_night>5）は2連続夜勤＋2連休を優先する（CONSTRAINTS.md §4）。
      // db[D]=1 ⟺ n[D]=1 かつ n[D+2]=1（2連続夜勤が成立）。上限を n に縛る（db<=n[D], db<=n[D+2]）ため、
      // 報酬の負係数でも db は unbounded にならず min(n[D],n[D+2]) に張り付く（両方夜勤のときだけ db=1）。
      // 連続成立後の 夜明夜明公公 は post_night_off / max2_consecutive_night / double_night_second_off が自動付与する。
      // 重み3: day_half(3)+consec_day_pen(2) を競合局面で上回りダブルを生むのに十分軽い均衡値。
      // これ以上強める（例:6）と分岐限定法が報酬最大化の枝へ誘導され、制約が緩い大規模インスタンスで
      // 最初の整数実行可能解の発見が30秒制限を超えて遅延する（軽い方がむしろダブルも増える）。
      const DOUBLE_NIGHT_REWARD = 3
      for (let dayIdx = 0; dayIdx + 2 < daysInMonth; dayIdx++) {
        const dbName = `double_night_reward__${member.id}__${dayIdx}`
        addContinuous(dbName)
        addObjective(dbName, -DOUBLE_NIGHT_REWARD)
        // db <= n[D]
        addRow(
          `double_night_le_first__${member.id}__${dayIdx}`,
          [
            { name: dbName,                                   coef:  1 },
            { name: varName('n', member.id, dayIdx),          coef: -1 },
          ],
          glpk.GLP_UP,
          0,
          0,
        )
        // db <= n[D+2]
        addRow(
          `double_night_le_second__${member.id}__${dayIdx}`,
          [
            { name: dbName,                                   coef:  1 },
            { name: varName('n', member.id, dayIdx + 2),      coef: -1 },
          ],
          glpk.GLP_UP,
          0,
          0,
        )
      }

      // 日勤の前後半バランス: 日勤を月前半・後半に均等配置
      // dayTarget = daysInMonth - 2*nightTarget - offTarget（夜+明を除いた推定値）
      const halfPoint = Math.floor(daysInMonth / 2)
      const memberOffTarget = personalTargetByStaff.get(member.id) ?? targetOffDays
      const dayShiftTarget = Math.max(0, daysInMonth - 2 * memberNightTarget - memberOffTarget)
      if (dayShiftTarget >= 2) {
        const expectedDayFirstHalf = Math.round(dayShiftTarget * halfPoint / daysInMonth)
        const dayHalfOverName  = `day_half_over__${member.id}`
        const dayHalfUnderName = `day_half_under__${member.id}`
        addContinuous(dayHalfOverName)
        addContinuous(dayHalfUnderName)
        addObjective(dayHalfOverName,  3)
        addObjective(dayHalfUnderName, 3)
        // dayHalfOver - dayHalfUnder - sum(w[0..halfPoint-1]) = -expectedDayFirstHalf
        addRow(
          `day_half_bal__${member.id}`,
          [
            { name: dayHalfOverName,  coef:  1 },
            { name: dayHalfUnderName, coef: -1 },
            ...Array.from({ length: halfPoint }, (_, d) => ({
              name: varName('w', member.id, d),
              coef: -1,
            })),
          ],
          glpk.GLP_FX,
          -expectedDayFirstHalf,
          -expectedDayFirstHalf,
        )
      }
    }

    // 3連続日勤のソフトペナルティ: 日勤が塊にならないよう均等化
    // consec_day_pen[D] >= w[D] + w[D+1] + w[D+2] - 2
    for (let dayIdx = 0; dayIdx + 2 < daysInMonth; dayIdx++) {
      const penName = `consec_day_pen__${member.id}__${dayIdx}`
      addContinuous(penName)
      addObjective(penName, 2)
      addRow(
        `consec_day_pen_row__${member.id}__${dayIdx}`,
        [
          { name: penName,                                  coef:  1 },
          { name: varName('w', member.id, dayIdx),          coef: -1 },
          { name: varName('w', member.id, dayIdx + 1),      coef: -1 },
          { name: varName('w', member.id, dayIdx + 2),      coef: -1 },
        ],
        glpk.GLP_LO,
        -2,
        0,
      )
    }
  }

  // 平日日勤の分散目的関数: ターゲットを超える人数にペナルティを加え均等化を促す
  if (targetDayPerWeekday > 0) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (dayMeta[dayIdx].isWeekend) continue
      const overName = `day_bal_over__${dayIdx}`
      addContinuous(overName)
      addObjective(overName, 3)
      // over >= sum(w[s][d]) - target  →  over - sum(w) >= -target
      addRow(
        `day_bal__${dayIdx}`,
        [
          { name: overName, coef: 1 },
          ...staff.map((member) => ({ name: varName('w', member.id, dayIdx), coef: -1 })),
        ],
        glpk.GLP_LO,
        -targetDayPerWeekday,
        0,
      )
    }
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
      // 前月繰越明け・希望休等で全シニアが強制不在の日はスキップしてwarning
      const allSeniorsForced = seniorStaff.every(m => {
        const mForcedAke = forcedAkeDays.get(m.id) ?? new Set<number>()
        const mFixedOff = fixedOffDays.get(m.id) ?? new Set<number>()
        const mLeaves = fixedLeaveCodes.get(m.id)
        const date = new Date(year, month - 1, dayIdx + 1)
        const isHol = HolidayJP.isHoliday(date)
        const hardDow = new Set(m.hard_off_days_of_week ?? [])
        const isHardOff = hardDow.has(date.getDay()) || (m.hard_off_on_holidays && isHol)
        return mForcedAke.has(dayIdx) || (mLeaves?.has(dayIdx) ?? false) || mFixedOff.has(dayIdx) || isHardOff
      })
      if (allSeniorsForced) {
        const dow = ['日','月','火','水','木','金','土'][new Date(year, month - 1, dayIdx + 1).getDay()]
        warnings.push(`シニアペア制約スキップ: ${dayIdx + 1}日(${dow})は全シニアが出勤不可（前月繰越・希望休等）のため制約を緩和しました`)
        continue
      }
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
    if (pair.constraint_type === 'senior_pair') {
      const pairMembers = [pair.staff_id_a, pair.staff_id_b].map(id => staff.find(m => m.id === id)).filter(Boolean) as StaffProfile[]
      for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
        if (dayMeta[dayIdx].isWeekend) continue
        // 両者が強制不在の日はスキップ（senior_day_coverage と同じ扱い）
        if (pairMembers.length === 2 && pairMembers.every(m => {
          const mForcedAke = forcedAkeDays.get(m.id) ?? new Set<number>()
          const mFixedOff = fixedOffDays.get(m.id) ?? new Set<number>()
          const mLeaves = fixedLeaveCodes.get(m.id)
          const date = new Date(year, month - 1, dayIdx + 1)
          const isHol = HolidayJP.isHoliday(date)
          const hardDow = new Set(m.hard_off_days_of_week ?? [])
          const isHardOff = hardDow.has(date.getDay()) || (m.hard_off_on_holidays && isHol)
          return mForcedAke.has(dayIdx) || (mLeaves?.has(dayIdx) ?? false) || mFixedOff.has(dayIdx) || isHardOff
        })) continue
        addRow(
          `senior_pair__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
          [
            { name: varName('w', pair.staff_id_a, dayIdx), coef: 1 },
            { name: varName('w', pair.staff_id_b, dayIdx), coef: 1 },
          ],
          glpk.GLP_LO,
          1,
          0,
        )
      }
      continue
    }

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
        // 土日祝はスキップ（両者休み・夜・明でも問題なし）
        if (dayMeta[dayIdx].isWeekend) continue
        // 「どちらかが公/夜/明なら、もう1人は必ず日勤」= 両者合わせて日勤が1人以上
        addRow(
          `must_pair_day_coverage__${pair.staff_id_a}__${pair.staff_id_b}__${dayIdx}`,
          [
            { name: varName('w', pair.staff_id_a, dayIdx), coef: 1 },
            { name: varName('w', pair.staff_id_b, dayIdx), coef: 1 },
          ],
          glpk.GLP_LO,
          1,
          0,
        )
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
      warnings: [...nightRequestWarnings, '制約を同時に満たすシフトを生成できませんでした。夜勤人数・休日数・希望休の組み合わせを見直してください。'],
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

  return { grid, warnings: [...nightRequestWarnings, ...warnings], targetOffDays, solverStatus: 'success' }
}
