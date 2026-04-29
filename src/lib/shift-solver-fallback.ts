import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import type { SolverInput, SolverOutput, ShiftCode, ShiftGrid } from './shift-solver'
import type { StaffPairConstraint } from '@/types'

function buildDayMeta(year: number, month: number, daysInMonth: number) {
  return Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(year, month - 1, i + 1)
    const dow = date.getDay()
    return { isWeekend: dow === 0 || dow === 6 || HolidayJP.isHoliday(date), date }
  })
}

function buildMustNotPairMap(pairConstraints: StaffPairConstraint[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const p of pairConstraints) {
    if (p.constraint_type !== 'must_not_pair') continue
    if (p.shift_type_id !== null && p.shift_type?.is_overnight === false) continue
    if (!map.has(p.staff_id_a)) map.set(p.staff_id_a, new Set())
    if (!map.has(p.staff_id_b)) map.set(p.staff_id_b, new Set())
    map.get(p.staff_id_a)!.add(p.staff_id_b)
    map.get(p.staff_id_b)!.add(p.staff_id_a)
  }
  return map
}

function hasDayMustNotPairOnDay(
  pairConstraints: StaffPairConstraint[],
  grid: ShiftGrid,
  staffId: string,
  dayIdx: number,
): boolean {
  return pairConstraints.some((pair) => {
    if (pair.constraint_type !== 'must_not_pair') return false
    if (pair.shift_type_id !== null && pair.shift_type?.is_overnight === true) return false

    const partnerId = pair.staff_id_a === staffId
      ? pair.staff_id_b
      : pair.staff_id_b === staffId
        ? pair.staff_id_a
        : null
    return partnerId !== null && grid[partnerId]?.[dayIdx] === '日'
  })
}

function countConsecutive(grid: ShiftGrid, staffId: string, dayIdx: number): number {
  let count = 0
  for (let i = dayIdx; i >= 0; i--) {
    const code = grid[staffId][i]
    if (code === '日' || code === '夜') count++
    else break
  }
  return count
}

function isSeniorRole(role: string): boolean {
  return role === '師長' || role === '主任'
}

function canAssignDayShift(
  grid: ShiftGrid,
  staffId: string,
  dayIdx: number,
  maxConsecutive: number,
): boolean {
  let consecutive = 1

  for (let i = dayIdx - 1; i >= 0; i--) {
    const code = grid[staffId][i]
    if (code === '日' || code === '夜') consecutive++
    else break
  }

  for (let i = dayIdx + 1; i < grid[staffId].length; i++) {
    const code = grid[staffId][i]
    if (code === '日' || code === '夜') consecutive++
    else break
  }

  return consecutive <= maxConsecutive
}

function canAssignOpenDayShift(
  pairConstraints: StaffPairConstraint[],
  grid: ShiftGrid,
  staffId: string,
  dayIdx: number,
  maxConsecutive: number,
): boolean {
  if (grid[staffId][dayIdx] !== '') return false
  if (countConsecutive(grid, staffId, dayIdx - 1) >= maxConsecutive) return false
  if (hasDayMustNotPairOnDay(pairConstraints, grid, staffId, dayIdx)) return false
  return true
}

export async function generateShiftsFallback(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, prevMonthTail } = input
  const warnings: string[] = ['⚠️ ベストエフォートで生成しました（一部制約を満たせない場合があります）']

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const dayMeta = buildDayMeta(year, month, daysInMonth)

  const minNight = (constraints?.min_staff_per_shift?.['夜勤']) ?? 2
  const minDay = (constraints?.min_staff_per_shift?.['日勤']) ?? 5
  const minWeekend = constraints?.min_staff_weekend ?? 2
  const maxWeekend = constraints?.max_staff_weekend ?? 2
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5
  const targetOffDays = constraints?.target_off_days ?? Math.round(daysInMonth * 0.27)

  const grid: ShiftGrid = Object.fromEntries(
    staff.map((m) => [m.id, Array(daysInMonth).fill('') as ShiftCode[]])
  )

  const mustNotPair = buildMustNotPairMap(pairConstraints)
  const seniorStaff = staff.filter((member) => isSeniorRole(member.role))

  // frozenCells: 上書き不可セル（Step A の確定 + Step B の夜勤セット）
  const frozenCells = new Set<string>()
  const freezeCell = (staffId: string, day: number) => frozenCells.add(`${staffId}:${day}`)
  const isFrozen = (staffId: string, day: number) => frozenCells.has(`${staffId}:${day}`)

  const nightCount = new Map<string, number>(staff.map((m) => [m.id, 0]))

  // ========================================================
  // Step A: ハード制約の事前確定
  // ========================================================

  // A-1: 前月持ち越し
  const prevNightDay0 = new Set<string>()
  const prevNightDay1 = new Set<string>()

  if (prevMonthTail && prevMonthTail.length > 0) {
    const byStaff = new Map<string, Map<number, string>>()
    for (const item of prevMonthTail) {
      if (!byStaff.has(item.staff_id)) byStaff.set(item.staff_id, new Map())
      byStaff.get(item.staff_id)!.set(item.day, item.shift_code)
    }
    for (const [staffId, days] of byStaff) {
      const lastDay = Math.max(...days.keys())
      if (days.get(lastDay) === '夜') prevNightDay0.add(staffId)
      if (days.get(lastDay - 1) === '夜' || days.get(lastDay) === '明') prevNightDay1.add(staffId)
    }
  }

  for (const staffId of prevNightDay0) {
    grid[staffId][0] = '明'
    freezeCell(staffId, 0)
    if (daysInMonth > 1) {
      grid[staffId][1] = '公'
      freezeCell(staffId, 1)
    }
  }
  for (const staffId of prevNightDay1) {
    if (grid[staffId][0] === '') {
      grid[staffId][0] = '公'
      freezeCell(staffId, 0)
    }
  }

  // A-2: 有給・希望休・特別休暇
  const leaveCodeMap: Record<string, ShiftCode> = {
    '希望休': '希休',
    '有給': '有',
    '特別休暇': '他',
    '他': '他',
  }
  for (const request of leaveRequests) {
    const [reqYear, reqMonth, reqDay] = request.date.split('-').map(Number)
    if (reqYear !== year || reqMonth !== month) continue
    const dayIdx = reqDay - 1
    if (dayIdx < 0 || dayIdx >= daysInMonth) continue
    if (request.type === 'シフト希望') continue

    const code = leaveCodeMap[request.type]
    if (!code) continue

    const current = grid[request.staff_id]?.[dayIdx]
    if (current === undefined) continue

    if (current === '') {
      grid[request.staff_id][dayIdx] = code
      freezeCell(request.staff_id, dayIdx)
    } else if (isFrozen(request.staff_id, dayIdx)) {
      // 前月持ち越しと希望休の矛盾を警告
      warnings.push(`${dayIdx + 1}日: ${request.staff_id} の${request.type}は前月持ち越しと矛盾するため適用できません`)
    }
  }

  // A-3: 定休日・祝日（hard のみ）
  for (const member of staff) {
    if (member.off_days_constraint !== 'hard') continue
    const offDow = new Set(member.off_days_of_week ?? [])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      const date = dayMeta[dayIdx].date
      const dow = date.getDay()
      if (offDow.has(dow) || (member.off_on_holidays && HolidayJP.isHoliday(date))) {
        grid[member.id][dayIdx] = '公'
        freezeCell(member.id, dayIdx)
      }
    }
  }

  // 詰み検出: 両シニアが同日に hard 定休で確定
  if (seniorStaff.length >= 2) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const allFrozen = seniorStaff.every((m) =>
        isFrozen(m.id, dayIdx) && grid[m.id][dayIdx] === '公'
      )
      if (allFrozen) {
        warnings.push(`${dayIdx + 1}日: 全シニアがハード制約により公休のためカバー不可（要設定見直し）`)
      }
    }
  }

  // ========================================================
  // Step B: 夜勤割り当て
  // ========================================================
  const nightCapable = staff.filter((m) => m.max_night_shifts > 0)

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const candidates = nightCapable.filter((m) => {
      // 自セル
      if (grid[m.id][dayIdx] !== '') return false
      if ((nightCount.get(m.id) ?? 0) >= m.max_night_shifts) return false

      // 前日制約
      if (dayIdx > 0 && (grid[m.id][dayIdx - 1] === '夜' || grid[m.id][dayIdx - 1] === '明')) return false
      if (dayIdx > 1 && grid[m.id][dayIdx - 2] === '夜') return false
      if (countConsecutive(grid, m.id, dayIdx - 1) >= maxConsecutive) return false

      // 翌日・翌々日: Step A 確定セルへの上書きを防ぐため '' のみ許可
      if (dayIdx + 1 < daysInMonth && grid[m.id][dayIdx + 1] !== '') return false
      if (dayIdx + 2 < daysInMonth && grid[m.id][dayIdx + 2] !== '') return false

      // シニア先読み: dayIdx, dayIdx+1, dayIdx+2 すべてで他シニアがカバー可能か確認
      if (isSeniorRole(m.role) && seniorStaff.length >= 2) {
        for (const offset of [0, 1, 2]) {
          const d = dayIdx + offset
          if (d >= daysInMonth) continue
          const otherCanCover = seniorStaff.some((senior) => {
            if (senior.id === m.id) return false
            if (grid[senior.id][d] !== '') return false
            if (countConsecutive(grid, senior.id, d - 1) >= maxConsecutive) return false
            if (hasDayMustNotPairOnDay(pairConstraints, grid, senior.id, d)) return false
            return true
          })
          if (!otherCanCover) return false
        }
      }

      return true
    })

    // must_not_pair を考慮して選出
    const assigned: string[] = []
    for (const candidate of candidates) {
      if (assigned.length >= minNight) break
      const partners = mustNotPair.get(candidate.id)
      if (partners && assigned.some((id) => partners.has(id))) continue
      assigned.push(candidate.id)
    }

    for (const staffId of assigned) {
      grid[staffId][dayIdx] = '夜'
      freezeCell(staffId, dayIdx)
      nightCount.set(staffId, (nightCount.get(staffId) ?? 0) + 1)
      if (dayIdx + 1 < daysInMonth) {
        grid[staffId][dayIdx + 1] = '明'
        freezeCell(staffId, dayIdx + 1)
      }
      if (dayIdx + 2 < daysInMonth) {
        grid[staffId][dayIdx + 2] = '公'
        freezeCell(staffId, dayIdx + 2)
      }
    }

    if (assigned.length < minNight) {
      warnings.push(`${dayIdx + 1}日: 夜勤 最低${minNight}人に対し${assigned.length}人しか確保できません`)
    }
  }

  // ========================================================
  // Step C: シニア日勤を優先確保（負荷分散）
  // ========================================================
  if (seniorStaff.length > 0) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const { isWeekend } = dayMeta[dayIdx]
      const max = isWeekend ? maxWeekend : 999

      const hasSeniorDayShift = seniorStaff.some((m) => grid[m.id][dayIdx] === '日')
      if (hasSeniorDayShift) continue

      const dayCount = staff.filter((m) => grid[m.id][dayIdx] === '日').length
      if (isWeekend && dayCount >= max) continue

      const seniorCandidates = seniorStaff
        .filter((m) => canAssignOpenDayShift(pairConstraints, grid, m.id, dayIdx, maxConsecutive))
        .sort((a, b) => {
          const consA = countConsecutive(grid, a.id, dayIdx - 1)
          const consB = countConsecutive(grid, b.id, dayIdx - 1)
          if (consA !== consB) return consA - consB
          const dayA = grid[a.id].filter((c) => c === '日').length
          const dayB = grid[b.id].filter((c) => c === '日').length
          return dayA - dayB
        })

      if (seniorCandidates.length > 0) {
        grid[seniorCandidates[0].id][dayIdx] = '日'
      } else {
        warnings.push(`${dayIdx + 1}日: 師長・主任の日勤を1人も確保できません`)
      }
    }
  }

  // ========================================================
  // Step D: 一般日勤で最低人数を充足
  // ========================================================
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { isWeekend } = dayMeta[dayIdx]
    const target = isWeekend ? minWeekend : minDay
    const max = isWeekend ? maxWeekend : 999

    let dayAssigned = staff.filter((m) => grid[m.id][dayIdx] === '日').length

    if (dayAssigned < target) {
      const candidates = staff.filter((m) => {
        if (grid[m.id][dayIdx] !== '') return false
        if (countConsecutive(grid, m.id, dayIdx - 1) >= maxConsecutive) return false
        if (hasDayMustNotPairOnDay(pairConstraints, grid, m.id, dayIdx)) return false
        return true
      })
      for (const candidate of candidates) {
        if (dayAssigned >= target) break
        if (isWeekend && dayAssigned >= max) break
        grid[candidate.id][dayIdx] = '日'
        dayAssigned++
      }
    }

    if (dayAssigned < target) {
      warnings.push(`${dayIdx + 1}日: 日勤 最低${target}人に対し${dayAssigned}人しか確保できません`)
    }

    // 残りを公休に（frozenCells には入れない）
    for (const member of staff) {
      if (grid[member.id][dayIdx] === '') grid[member.id][dayIdx] = '公'
    }
  }

  // ========================================================
  // Step E: 休日数調整
  // ========================================================
  const offCodes: ShiftCode[] = ['公', '有', '他', '希休']
  const isOffCode = (c: ShiftCode) => offCodes.includes(c)

  for (const member of staff) {
    const offCount = grid[member.id].filter(isOffCode).length
    const diff = offCount - targetOffDays

    if (diff > 0) {
      // 超過: 公休 → 日勤
      let reduced = 0
      for (let dayIdx = 0; dayIdx < daysInMonth && reduced < diff; dayIdx++) {
        if (grid[member.id][dayIdx] !== '公') continue
        if (isFrozen(member.id, dayIdx)) continue
        if (dayMeta[dayIdx].isWeekend) continue
        if (!canAssignDayShift(grid, member.id, dayIdx, maxConsecutive)) continue
        if (hasDayMustNotPairOnDay(pairConstraints, grid, member.id, dayIdx)) continue
        const dayCount = staff.filter((m) => grid[m.id][dayIdx] === '日').length
        if (dayMeta[dayIdx].isWeekend && dayCount >= maxWeekend) continue
        grid[member.id][dayIdx] = '日'
        reduced++
      }
    } else if (diff < 0) {
      // 不足: 日勤 → 公休
      let added = 0
      const needed = -diff
      for (let dayIdx = 0; dayIdx < daysInMonth && added < needed; dayIdx++) {
        if (grid[member.id][dayIdx] !== '日') continue
        const dayCount = staff.filter((m) => grid[m.id][dayIdx] === '日').length
        const { isWeekend } = dayMeta[dayIdx]
        const minRequired = isWeekend ? minWeekend : minDay
        if (dayCount <= minRequired) continue
        if (isSeniorRole(member.role)) {
          // シニアの場合、その日に他シニアが '日' でなければ変換禁止（公+公防止）
          const otherSeniorOnDuty = seniorStaff.some((s) => s.id !== member.id && grid[s.id][dayIdx] === '日')
          if (!otherSeniorOnDuty) continue
        }
        grid[member.id][dayIdx] = '公'
        added++
      }
    }
  }

  return { grid, warnings, targetOffDays }
}
