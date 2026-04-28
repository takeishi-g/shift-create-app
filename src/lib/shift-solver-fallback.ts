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

function canSeniorCoverDay(grid: ShiftGrid, staffId: string, dayIdx: number, maxConsecutive: number): boolean {
  const code = grid[staffId][dayIdx]
  if (code === '明' || code === '夜') return false
  return canAssignDayShift(grid, staffId, dayIdx, maxConsecutive)
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

  // グリッド初期化
  const grid: ShiftGrid = Object.fromEntries(
    staff.map((m) => [m.id, Array(daysInMonth).fill('') as ShiftCode[]])
  )

  const mustNotPair = buildMustNotPairMap(pairConstraints)

  // 夜勤カウント管理
  const nightCount = new Map<string, number>(staff.map((m) => [m.id, 0]))

  // 前月末の夜勤持ち越し処理
  const prevNightDay0 = new Set<string>() // 前月最終日が夜勤 → 当月1日目が明け
  const prevNightDay1 = new Set<string>() // 前月最後から2日目が夜勤 → 当月1日目が強制休

  if (prevMonthTail && prevMonthTail.length > 0) {
    const byStaff = new Map<string, Map<number, string>>()
    for (const item of prevMonthTail) {
      if (!byStaff.has(item.staff_id)) byStaff.set(item.staff_id, new Map())
      byStaff.get(item.staff_id)!.set(item.day, item.shift_code)
    }
    for (const [staffId, days] of byStaff) {
      const lastDay = Math.max(...days.keys())
      if (days.get(lastDay) === '夜') {
        prevNightDay0.add(staffId) // day0 = 明け
        // day1 = 強制休は後述
      }
      if (days.get(lastDay - 1) === '夜' || days.get(lastDay) === '明') {
        prevNightDay1.add(staffId) // day0 = 強制休
      }
    }
  }

  // 前月持ち越しで day0・day1 を設定
  for (const staffId of prevNightDay0) {
    grid[staffId][0] = '明'
    // 夜勤明けの翌日（day1）も強制休
    if (daysInMonth > 1 && grid[staffId][1] === '') grid[staffId][1] = '公'
  }

  // --- Pass 1: 夜勤割り当て ---
  const nightCapable = staff.filter((m) => m.max_night_shifts > 0)
  const seniorStaff = staff.filter((member) => isSeniorRole(member.role))

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const assigned: string[] = []

    // すでに割り当て済み（明け・前月持ち越し）のスタッフを除外
    const candidates = nightCapable.filter((m) => {
      if (grid[m.id][dayIdx] !== '') return false // すでに割り当て済み
      if ((nightCount.get(m.id) ?? 0) >= m.max_night_shifts) return false // 上限超え
      if (dayIdx > 0 && grid[m.id][dayIdx - 1] === '夜') return false // 前日夜勤（明けが必要）
      if (dayIdx > 0 && grid[m.id][dayIdx - 1] === '明') return false // 前日明け（休みが必要）
      if (dayIdx > 1 && grid[m.id][dayIdx - 2] === '夜') return false // 2日前夜勤（本日は明け翌日で休みが必要）
      if (countConsecutive(grid, m.id, dayIdx - 1) >= maxConsecutive) return false // 連勤超え
      // 夜勤後の明け・公休を置けるか確認
      if (dayIdx + 1 < daysInMonth && grid[m.id][dayIdx + 1] !== '' && grid[m.id][dayIdx + 1] !== '明') return false
      if (dayIdx + 2 < daysInMonth && grid[m.id][dayIdx + 2] !== '' && grid[m.id][dayIdx + 2] !== '公') return false
      if (isSeniorRole(m.role)) {
        const hasOtherSeniorCoverageToday = seniorStaff.some((senior) => {
          if (senior.id === m.id) return false
          return canSeniorCoverDay(grid, senior.id, dayIdx, maxConsecutive)
        })
        if (!hasOtherSeniorCoverageToday) return false

        if (dayIdx + 1 < daysInMonth) {
          const hasOtherSeniorCoverageNextDay = seniorStaff.some((senior) => {
            if (senior.id === m.id) return false
            const nextDayCode = grid[senior.id][dayIdx + 1]
            if (nextDayCode !== '' && nextDayCode !== '公') return false
            return canAssignDayShift(grid, senior.id, dayIdx + 1, maxConsecutive)
          })
          if (!hasOtherSeniorCoverageNextDay) return false
        }
      }
      return true
    })

    // must_not_pair を考慮して選出
    for (const candidate of candidates) {
      if (assigned.length >= minNight) break
      const partners = mustNotPair.get(candidate.id)
      if (partners && assigned.some((id) => partners.has(id))) continue
      assigned.push(candidate.id)
    }

    for (const staffId of assigned) {
      grid[staffId][dayIdx] = '夜'
      nightCount.set(staffId, (nightCount.get(staffId) ?? 0) + 1)
      // 翌日を明けに設定（夜勤セットは3点必須）
      if (dayIdx + 1 < daysInMonth) grid[staffId][dayIdx + 1] = '明'
      // 翌々日を強制休に設定（無条件）
      if (dayIdx + 2 < daysInMonth) grid[staffId][dayIdx + 2] = '公'
    }

    if (assigned.length < minNight) {
      warnings.push(`${dayIdx + 1}日: 夜勤 最低${minNight}人に対し${assigned.length}人しか確保できません`)
    }
  }

  // --- Pass 2: 固定休・希望反映 ---
  for (const request of leaveRequests) {
    const [reqYear, reqMonth, reqDay] = request.date.split('-').map(Number)
    if (reqYear !== year || reqMonth !== month) continue
    const dayIdx = reqDay - 1
    if (dayIdx < 0 || dayIdx >= daysInMonth) continue

    if (grid[request.staff_id]?.[dayIdx] !== '' && grid[request.staff_id]?.[dayIdx] !== '公') continue

    if (request.type === 'シフト希望') {
      // シフト希望は Pass1 の夜勤割り当てで考慮済みのため、ここでは何もしない
      continue
    }

    const codeMap: Record<string, ShiftCode> = {
      '希望休': '希休',
      '有給': '有',
      '特別休暇': '他',
      '他': '他',
    }
    const code = codeMap[request.type]
    if (code && grid[request.staff_id][dayIdx] === '') {
      grid[request.staff_id][dayIdx] = code
    }
  }

  // hard な定休曜日・祝日を公休に設定
  for (const member of staff) {
    if (member.off_days_constraint !== 'hard') continue
    const offDow = new Set(member.off_days_of_week ?? [])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      const date = dayMeta[dayIdx].date
      const dow = date.getDay()
      if (offDow.has(dow) || (member.off_on_holidays && HolidayJP.isHoliday(date))) {
        grid[member.id][dayIdx] = '公'
      }
    }
  }

  // 前月持ち越しで day0 強制休
  for (const staffId of prevNightDay1) {
    if (grid[staffId][0] === '') grid[staffId][0] = '公'
  }

  // --- Pass 3: 日勤割り当て ---
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { isWeekend } = dayMeta[dayIdx]
    const target = isWeekend ? minWeekend : minDay
    const max = isWeekend ? maxWeekend : 999

    const currentDay = staff.filter((m) => grid[m.id][dayIdx] === '日').length
    let dayAssigned = currentDay

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

    // 残りを公休に
    for (const member of staff) {
      if (grid[member.id][dayIdx] === '') grid[member.id][dayIdx] = '公'
    }
  }

  // --- Pass 4: 師長・主任の日勤カバレッジ補正 ---
  if (seniorStaff.length > 0) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const hasSeniorDayShift = seniorStaff.some((member) => grid[member.id][dayIdx] === '日')
      if (hasSeniorDayShift) continue

      const replacement = seniorStaff.find((member) => {
        if (grid[member.id][dayIdx] !== '公') return false
        if (!canAssignDayShift(grid, member.id, dayIdx, maxConsecutive)) return false
        if (hasDayMustNotPairOnDay(pairConstraints, grid, member.id, dayIdx)) return false
        return true
      })

      if (replacement) {
        grid[replacement.id][dayIdx] = '日'
        continue
      }

      warnings.push(`${dayIdx + 1}日: 師長・主任の日勤を1人も確保できません`)
    }
  }

  // --- Pass 5: 休日数調整 ---
  const offCodes: ShiftCode[] = ['公', '有', '他', '希休']
  const isOffCode = (c: ShiftCode) => offCodes.includes(c)

  for (const member of staff) {
    const offCount = grid[member.id].filter(isOffCode).length
    const diff = offCount - targetOffDays

    if (diff > 0) {
      // 超過: 公休 → 日勤（平日・連勤超えない日のみ）
      let reduced = 0
      for (let dayIdx = 0; dayIdx < daysInMonth && reduced < diff; dayIdx++) {
        if (grid[member.id][dayIdx] !== '公') continue
        if (dayMeta[dayIdx].isWeekend) continue
        // 明け翌日は変換しない
        if (dayIdx > 0 && grid[member.id][dayIdx - 1] === '明') continue
        if (!canAssignDayShift(grid, member.id, dayIdx, maxConsecutive)) continue
        if (hasDayMustNotPairOnDay(pairConstraints, grid, member.id, dayIdx)) continue
        // 最低人数チェック
        const dayCount = staff.filter((m) => grid[m.id][dayIdx] === '日').length
        if (dayMeta[dayIdx].isWeekend && dayCount >= maxWeekend) continue
        grid[member.id][dayIdx] = '日'
        reduced++
      }
    } else if (diff < 0) {
      // 不足: 日勤 → 公休（最低人数を下回らない日のみ）
      let added = 0
      const needed = -diff
      for (let dayIdx = 0; dayIdx < daysInMonth && added < needed; dayIdx++) {
        if (grid[member.id][dayIdx] !== '日') continue
        const dayCount = staff.filter((m) => grid[m.id][dayIdx] === '日').length
        const { isWeekend } = dayMeta[dayIdx]
        const minRequired = isWeekend ? minWeekend : minDay
        if (dayCount <= minRequired) continue
        if (isSeniorRole(member.role)) {
          const seniorDayCount = seniorStaff.filter((senior) => grid[senior.id][dayIdx] === '日').length
          if (seniorDayCount <= 1) continue
        }
        grid[member.id][dayIdx] = '公'
        added++
      }
    }
  }

  return { grid, warnings, targetOffDays }
}
