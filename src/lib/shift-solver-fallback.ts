import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import type { ShiftCode, ShiftGrid, SolverInput, SolverOutput } from './shift-solver'

function emptyGrid(staff: SolverInput['staff'], daysInMonth: number): ShiftGrid {
  return Object.fromEntries(
    staff.map((member) => [member.id, Array(daysInMonth).fill('') as ShiftCode[]]),
  )
}

function isWork(code: ShiftCode): boolean {
  return code === '日' || code === '夜'
}

function isOff(code: ShiftCode): boolean {
  return code === '公' || code === '有' || code === '他' || code === '希休'
}

function canAssignNight(grid: ShiftGrid, staffId: string, dayIdx: number, maxConsecutive: number): boolean {
  const shifts = grid[staffId]
  if (shifts[dayIdx] !== '') return false
  if (dayIdx > 0 && (shifts[dayIdx - 1] === '夜' || shifts[dayIdx - 1] === '明')) return false
  if (dayIdx + 1 < shifts.length && shifts[dayIdx + 1] !== '') return false
  if (dayIdx + 2 < shifts.length && shifts[dayIdx + 2] !== '') return false

  let streak = 1
  for (let idx = dayIdx - 1; idx >= 0; idx--) {
    if (isWork(shifts[idx])) streak += 1
    else break
  }
  return streak <= maxConsecutive
}

function canAssignDay(grid: ShiftGrid, staffId: string, dayIdx: number, maxConsecutive: number): boolean {
  const shifts = grid[staffId]
  if (shifts[dayIdx] !== '') return false
  if (dayIdx > 0 && (shifts[dayIdx - 1] === '夜' || shifts[dayIdx - 1] === '明')) return false
  if (dayIdx + 1 < shifts.length && shifts[dayIdx + 1] === '夜') return false

  let before = 0
  for (let idx = dayIdx - 1; idx >= 0; idx--) {
    if (isWork(shifts[idx])) before += 1
    else break
  }
  let after = 0
  for (let idx = dayIdx + 1; idx < shifts.length; idx++) {
    if (isWork(shifts[idx])) after += 1
    else break
  }
  return before + 1 + after <= maxConsecutive
}

function getDayRequirements(
  constraints: SolverInput['constraints'],
  shiftTypes: SolverInput['shiftTypes'],
  dayIdx: number,
  year: number,
  month: number,
  bathSet: Set<number>,
) {
  const date = new Date(year, month - 1, dayIdx + 1)
  const isWeekend = date.getDay() === 0 || date.getDay() === 6 || HolidayJP.isHoliday(date)
  const nightShiftType = shiftTypes?.find((shiftType) => shiftType.is_overnight && !shiftType.is_off)
  const dayShiftType = shiftTypes?.find((shiftType) => !shiftType.is_overnight && !shiftType.is_off)
  const dayKey = dayShiftType?.name ?? '日勤'
  const minDay = Number(constraints?.min_staff_per_shift?.[dayKey] ?? constraints?.min_staff_per_shift?.['日勤'] ?? 3)
  const maxDay = Number(constraints?.max_staff_per_shift?.[dayKey] ?? constraints?.max_staff_per_shift?.['日勤'] ?? minDay)
  const minWeekend = constraints?.min_staff_weekend ?? minDay
  const maxWeekend = constraints?.max_staff_weekend ?? maxDay
  const minBathDay = constraints?.min_staff_bath_day ?? minDay
  const requiredDay = bathSet.has(dayIdx)
    ? Math.max(isWeekend ? minWeekend : minDay, minBathDay)
    : (isWeekend ? minWeekend : minDay)
  const dayLimit = isWeekend ? maxWeekend : maxDay
  const nightKey = nightShiftType?.name ?? '夜勤'
  const minNight = Number(constraints?.min_staff_per_shift?.[nightKey] ?? constraints?.min_staff_per_shift?.['夜勤'] ?? 2)
  return { requiredDay, dayLimit, minNight, isWeekend }
}

export async function generateShiftsFallback(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, shiftTypes, bathDayIndices, prevMonthTail } = input
  const warnings: string[] = ['⚠️ 制約ソルバーで解けなかったため、ベストエフォートで生成しました']

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const grid = emptyGrid(staff, daysInMonth)
  const targetOffDays = constraints?.target_off_days ?? Math.round(daysInMonth * 0.27)
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5

  const paidLeaveCountByStaff = new Map<string, number>()
  const nightCount = new Map<string, number>(staff.map((member) => [member.id, 0]))
  const bathSet = new Set(bathDayIndices)

  for (const leaveRequest of leaveRequests) {
    const [reqYear, reqMonth, reqDay] = leaveRequest.date.split('-').map(Number)
    if (reqYear !== year || reqMonth !== month) continue
    const dayIdx = reqDay - 1
    if (dayIdx < 0 || dayIdx >= daysInMonth || !grid[leaveRequest.staff_id]) continue

    if (leaveRequest.type === '有給') {
      paidLeaveCountByStaff.set(leaveRequest.staff_id, (paidLeaveCountByStaff.get(leaveRequest.staff_id) ?? 0) + 1)
      grid[leaveRequest.staff_id][dayIdx] = '有'
      continue
    }
    if (leaveRequest.type === '希望休') {
      grid[leaveRequest.staff_id][dayIdx] = '希休'
      continue
    }
    if (leaveRequest.type === '特別休暇' || leaveRequest.type === '他') {
      grid[leaveRequest.staff_id][dayIdx] = '他'
      continue
    }
  }

  if (prevMonthTail) {
    const byStaff = new Map<string, Map<number, string>>()
    for (const item of prevMonthTail) {
      const days = byStaff.get(item.staff_id) ?? new Map<number, string>()
      days.set(item.day, item.shift_code)
      byStaff.set(item.staff_id, days)
    }
    for (const [staffId, days] of byStaff) {
      const lastDay = Math.max(...days.keys())
      const lastCode = days.get(lastDay) ?? ''
      const secondLastCode = days.get(lastDay - 1) ?? ''
      if (lastCode === '夜') {
        grid[staffId][0] = '明'
        if (daysInMonth > 1 && grid[staffId][1] === '') grid[staffId][1] = '公'
      } else if (lastCode === '明' || secondLastCode === '夜') {
        if (grid[staffId][0] === '') grid[staffId][0] = '公'
      }
    }
  }

  for (const member of staff) {
    const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      const date = new Date(year, month - 1, dayIdx + 1)
      if (hardOffDow.has(date.getDay()) || (member.hard_off_on_holidays && HolidayJP.isHoliday(date))) {
        grid[member.id][dayIdx] = '公'
      }
    }
  }

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { minNight } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet)
    const assignedNightIds = new Set<string>()
    staff.forEach((member) => {
      if (grid[member.id][dayIdx] === '夜') assignedNightIds.add(member.id)
    })

    const nightCandidates = [...staff]
      .filter((member) => member.max_night_shifts > (nightCount.get(member.id) ?? 0))
      .filter((member) => canAssignNight(grid, member.id, dayIdx, maxConsecutive))
      .filter((member) =>
        !pairConstraints.some((pair) => {
          if (pair.constraint_type !== 'must_not_pair') return false
          if (pair.shift_type_id !== null && pair.shift_type?.is_overnight === false) return false
          const partnerId =
            pair.staff_id_a === member.id ? pair.staff_id_b
            : pair.staff_id_b === member.id ? pair.staff_id_a
            : null
          return partnerId !== null && assignedNightIds.has(partnerId)
        }),
      )
      .sort((left, right) => (nightCount.get(left.id) ?? 0) - (nightCount.get(right.id) ?? 0))

    while (assignedNightIds.size < minNight && nightCandidates.length > 0) {
      const candidate = nightCandidates.shift()
      if (!candidate) break
      assignedNightIds.add(candidate.id)
      grid[candidate.id][dayIdx] = '夜'
      nightCount.set(candidate.id, (nightCount.get(candidate.id) ?? 0) + 1)
      if (dayIdx + 1 < daysInMonth) grid[candidate.id][dayIdx + 1] = '明'
      if (dayIdx + 2 < daysInMonth && grid[candidate.id][dayIdx + 2] === '') grid[candidate.id][dayIdx + 2] = '公'
    }
  }

  const seniorIds = new Set(staff.filter((member) => member.role === '師長' || member.role === '主任').map((member) => member.id))

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { requiredDay, dayLimit, isWeekend } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet)

    if (!isWeekend && !staff.some((member) => seniorIds.has(member.id) && grid[member.id][dayIdx] === '日')) {
      const seniorCandidate = staff
        .filter((member) => seniorIds.has(member.id))
        .find((member) => canAssignDay(grid, member.id, dayIdx, maxConsecutive))
      if (seniorCandidate) grid[seniorCandidate.id][dayIdx] = '日'
    }

    let dayCount = staff.filter((member) => grid[member.id][dayIdx] === '日').length
    const dayCandidates = [...staff]
      .filter((member) => canAssignDay(grid, member.id, dayIdx, maxConsecutive))
      .sort((left, right) => {
        const leftOffs = grid[left.id].filter(isOff).length
        const rightOffs = grid[right.id].filter(isOff).length
        return rightOffs - leftOffs
      })

    for (const candidate of dayCandidates) {
      if (dayCount >= requiredDay || dayCount >= dayLimit) break
      grid[candidate.id][dayIdx] = '日'
      dayCount += 1
    }
  }

  for (const member of staff) {
    const target = targetOffDays + (paidLeaveCountByStaff.get(member.id) ?? 0)
    let currentOffs = grid[member.id].filter(isOff).length
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      if (currentOffs < target) {
        grid[member.id][dayIdx] = '公'
        currentOffs += 1
        continue
      }

      const { dayLimit } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet)
      const currentDayCount = staff.filter((candidate) => grid[candidate.id][dayIdx] === '日').length
      if (currentDayCount < dayLimit && canAssignDay(grid, member.id, dayIdx, maxConsecutive)) {
        grid[member.id][dayIdx] = '日'
      } else {
        grid[member.id][dayIdx] = '公'
        warnings.push(`${member.name}: ${dayIdx + 1}日は制約都合で公休に退避しました`)
      }
    }
  }

  let fallbackStatus: SolverOutput['solverStatus'] = 'success'
  for (const pair of pairConstraints) {
    if (pair.constraint_type !== 'must_pair') continue
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const a = grid[pair.staff_id_a]?.[dayIdx]
      const b = grid[pair.staff_id_b]?.[dayIdx]
      if (a === undefined || b === undefined) continue
      const violated =
        pair.shift_type_id === null ? a !== b
        : pair.shift_type?.is_overnight === true ? ((a === '夜') !== (b === '夜'))
        : ((a === '日') !== (b === '日'))
      if (violated) {
        warnings.push(`必ペア制約: ${dayIdx + 1}日 ${pair.staff_id_a} / ${pair.staff_id_b} を満たせませんでした`)
        fallbackStatus = 'error'
        break
      }
    }
  }

  return {
    grid,
    warnings,
    targetOffDays,
    solverStatus: fallbackStatus,
  }
}
