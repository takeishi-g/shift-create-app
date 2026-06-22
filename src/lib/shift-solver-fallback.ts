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

  const prev = dayIdx > 0 ? shifts[dayIdx - 1] : ''

  // 直前が夜勤: 不可
  if (prev === '夜') return false

  // 直前が明け: 2連続夜勤の2本目として許可するが、3連続以上は不可
  if (prev === '明') {
    const prevPrev = dayIdx > 1 ? shifts[dayIdx - 2] : ''
    if (prevPrev !== '夜') return false // 明の前が夜でない場合は不可
    // 3連続夜勤防止: 直前4マスが 夜→明→夜→明 なら3本目は不可
    if (
      dayIdx >= 4 &&
      shifts[dayIdx - 4] === '夜' &&
      shifts[dayIdx - 3] === '明' &&
      shifts[dayIdx - 2] === '夜' &&
      shifts[dayIdx - 1] === '明'
    ) return false
  }

  // 翌日（明けスロット）が空いていること
  if (dayIdx + 1 < shifts.length && shifts[dayIdx + 1] !== '') return false

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
  customHolidayDates?: string[],
) {
  const date = new Date(year, month - 1, dayIdx + 1)
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
  const isWeekend =
    date.getDay() === 0 ||
    date.getDay() === 6 ||
    HolidayJP.isHoliday(date) ||
    (customHolidayDates ?? []).includes(dateStr)
  const nightShiftType = shiftTypes?.find((shiftType) => shiftType.is_overnight && !shiftType.is_off)
  const dayShiftType = shiftTypes?.find((shiftType) => !shiftType.is_overnight && !shiftType.is_off)
  const dayKey = dayShiftType?.name ?? '日勤'
  const minDay = Number(constraints?.min_staff_per_shift?.[dayKey] ?? constraints?.min_staff_per_shift?.['日勤'] ?? 3)
  const maxDay = Number(constraints?.max_staff_per_shift?.[dayKey] ?? constraints?.max_staff_per_shift?.['日勤'] ?? minDay)
  const minWeekend = constraints?.min_staff_weekend ?? minDay
  const maxWeekend = constraints?.max_staff_weekend ?? maxDay
  const minBathDay = constraints?.min_staff_bath_day ?? minDay
  // 風呂日最低人数は「平日のみ」適用（CSP側 getShiftMinimums と対称）。土日祝の風呂日に minBathDay を
  // 課すと、その日の上限(maxWeekend)を上回り requiredDay>dayLimit になりベストエフォート生成が破綻するため除外。
  // 詳細は docs/CONSTRAINTS.md §6。
  const requiredDay = bathSet.has(dayIdx) && !isWeekend
    ? Math.max(minDay, minBathDay)
    : (isWeekend ? minWeekend : minDay)
  const dayLimit = isWeekend ? maxWeekend : maxDay
  const nightKey = nightShiftType?.name ?? '夜勤'
  const minNight = Number(constraints?.min_staff_per_shift?.[nightKey] ?? constraints?.min_staff_per_shift?.['夜勤'] ?? 2)
  return { requiredDay, dayLimit, minNight, isWeekend }
}

function isWeekdayDate(year: number, month: number, dayIdx: number, customHolidayDates?: string[]): boolean {
  const date = new Date(year, month - 1, dayIdx + 1)
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
  return (
    date.getDay() !== 0 &&
    date.getDay() !== 6 &&
    !HolidayJP.isHoliday(date) &&
    !(customHolidayDates ?? []).includes(dateStr)
  )
}

export async function generateShiftsFallback(input: SolverInput): Promise<SolverOutput> {
  const { yearMonth, staff, constraints, leaveRequests, pairConstraints, shiftTypes, bathDayIndices, prevMonthTail, customHolidayDates } = input
  const warnings: string[] = ['⚠️ 制約ソルバーで解けなかったため、ベストエフォートで生成しました']

  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const grid = emptyGrid(staff, daysInMonth)
  const targetOffDays = constraints?.target_off_days ?? Math.round(daysInMonth * 0.27)
  const maxConsecutive = constraints?.max_consecutive_work_days ?? 5

  const paidLeaveCountByStaff = new Map<string, number>()
  const nightCount = new Map<string, number>(staff.map((member) => [member.id, 0]))
  const bathSet = new Set(bathDayIndices)

  // Phase 1: 休暇申請の確定
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

  // Phase 1b: 前月末シフトの引き継ぎ
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
        // 前月末が2連続夜勤の末尾（末尾-1日が '明'）なら当月3日目も公休
        if (secondLastCode === '明' && daysInMonth > 2 && grid[staffId][2] === '') {
          grid[staffId][2] = '公'
        }
      } else if (lastCode === '明' || secondLastCode === '夜') {
        if (grid[staffId][0] === '') grid[staffId][0] = '公'
      }
    }
  }

  // Phase 1c: ハード定休日の確定
  for (const member of staff) {
    const hardOffDow = new Set(member.hard_off_days_of_week ?? [])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      const date = new Date(year, month - 1, dayIdx + 1)
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
      const isHoliday = HolidayJP.isHoliday(date) || (customHolidayDates ?? []).includes(dateStr)
      if (hardOffDow.has(date.getDay()) || (member.hard_off_on_holidays && isHoliday)) {
        grid[member.id][dayIdx] = '公'
      }
    }
  }

  const seniorIds = new Set(staff.filter((member) => member.role === '師長' || member.role === '主任').map((member) => member.id))

  // 夜勤分散用: スタッフごとの最終夜勤日を追跡
  const lastNightDay = new Map<string, number>()

  // Phase 2: 夜勤アサイン（D+2の公休は後処理で付与）
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { minNight, isWeekend } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet, customHolidayDates)
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
      .filter((member) => {
        if (!seniorIds.has(member.id)) return true
        // 当日の平日シニアカバレッジチェック
        if (!isWeekend) {
          const otherSeniorCanCoverToday = staff.some(
            (s) => s.id !== member.id && seniorIds.has(s.id) &&
              (grid[s.id][dayIdx] === '日' || canAssignDay(grid, s.id, dayIdx, maxConsecutive)),
          )
          if (!otherSeniorCanCoverToday) return false
        }
        // D+2（公休予定日）が平日なら、他シニアがカバーできるかチェック
        if (dayIdx + 2 < daysInMonth && isWeekdayDate(year, month, dayIdx + 2, customHolidayDates)) {
          const otherSeniorCanCoverPostNight = staff.some(
            (s) => s.id !== member.id && seniorIds.has(s.id) &&
              (grid[s.id][dayIdx + 2] === '日' || canAssignDay(grid, s.id, dayIdx + 2, maxConsecutive)),
          )
          if (!otherSeniorCanCoverPostNight) return false
        }
        return true
      })
      .filter((member) => {
        // 夜勤分散: 夜勤回数が少ないスタッフ（≤5回）に最小間隔を設ける
        if (member.max_night_shifts > 5) return true
        const last = lastNightDay.get(member.id) ?? -999
        const gap = dayIdx - last
        // 5回以下は連続夜勤禁止（週1ペース・単独夜勤のみ）
        // gap===2 の例外なし
        const minGap = Math.max(5, Math.floor(daysInMonth / member.max_night_shifts))
        return gap >= minGap
      })
      .sort((left, right) => {
        // 第1キー: 夜勤回数が少ない順
        const countDiff = (nightCount.get(left.id) ?? 0) - (nightCount.get(right.id) ?? 0)
        if (countDiff !== 0) return countDiff
        // 第2キー: 最終夜勤日が古い順（均等分散）
        const lastLeft = lastNightDay.get(left.id) ?? -999
        const lastRight = lastNightDay.get(right.id) ?? -999
        return lastLeft - lastRight
      })

    while (assignedNightIds.size < minNight && nightCandidates.length > 0) {
      const candidate = nightCandidates.shift()
      if (!candidate) break

      // シニア: アサイン直前に再チェック（リスト構築後の状態変化を考慮）
      if (seniorIds.has(candidate.id)) {
        if (!isWeekend) {
          const otherSeniorCanCoverToday = staff.some(
            (s) => s.id !== candidate.id && seniorIds.has(s.id) &&
              (grid[s.id][dayIdx] === '日' || canAssignDay(grid, s.id, dayIdx, maxConsecutive)),
          )
          if (!otherSeniorCanCoverToday) continue
        }
        if (dayIdx + 2 < daysInMonth && isWeekdayDate(year, month, dayIdx + 2, customHolidayDates)) {
          const otherSeniorCanCoverPostNight = staff.some(
            (s) => s.id !== candidate.id && seniorIds.has(s.id) &&
              (grid[s.id][dayIdx + 2] === '日' || canAssignDay(grid, s.id, dayIdx + 2, maxConsecutive)),
          )
          if (!otherSeniorCanCoverPostNight) continue
        }
      }

      assignedNightIds.add(candidate.id)
      grid[candidate.id][dayIdx] = '夜'
      nightCount.set(candidate.id, (nightCount.get(candidate.id) ?? 0) + 1)
      lastNightDay.set(candidate.id, dayIdx)
      if (dayIdx + 1 < daysInMonth) grid[candidate.id][dayIdx + 1] = '明'
      // D+2の公休は Phase 2b で付与（2連続夜勤対応のため即時確定しない）
    }
  }

  // Phase 2b: 夜勤後公休の付与
  // 単独夜勤: D+2=公
  // 2連続夜勤の末尾: D+2=公 + D+3=公（夜→明→夜→明→休→休）
  for (const member of staff) {
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '夜') continue
      // 2連続夜勤の1本目（D+1=明, D+2=夜）はスキップ。末尾の夜勤が担当する
      if (
        dayIdx + 2 < daysInMonth &&
        grid[member.id][dayIdx + 1] === '明' &&
        grid[member.id][dayIdx + 2] === '夜'
      ) continue

      // D+2 = 公（既に別のコードで埋まっている場合は警告）
      if (dayIdx + 2 < daysInMonth) {
        if (grid[member.id][dayIdx + 2] === '') {
          grid[member.id][dayIdx + 2] = '公'
        } else if (!isOff(grid[member.id][dayIdx + 2])) {
          warnings.push(`${member.name}: ${dayIdx + 3}日の夜勤後公休スロットが '${grid[member.id][dayIdx + 2]}' で埋まっています`)
        }
      }
      // 2連続夜勤の末尾（直前が 夜→明 パターン）なら D+3 にも公休
      const isSecondConsecutive =
        dayIdx >= 2 &&
        grid[member.id][dayIdx - 1] === '明' &&
        grid[member.id][dayIdx - 2] === '夜'
      if (isSecondConsecutive && dayIdx + 3 < daysInMonth && grid[member.id][dayIdx + 3] === '') {
        grid[member.id][dayIdx + 3] = '公'
      }
    }
  }

  // Phase 3: 日勤アサイン（シニアカバレッジ優先）
  // carryOver を Phase 3 で参照するため先に定義
  const carryOverByStaff = input.carryOverByStaff ?? {}
  let fallbackStatus: SolverOutput['solverStatus'] = 'success'
  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const { requiredDay, dayLimit, isWeekend } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet, customHolidayDates)

    if (!isWeekend && !staff.some((member) => seniorIds.has(member.id) && grid[member.id][dayIdx] === '日')) {
      const seniorCandidate = staff
        .filter((member) => seniorIds.has(member.id))
        .find((member) => canAssignDay(grid, member.id, dayIdx, maxConsecutive))
      if (seniorCandidate) {
        grid[seniorCandidate.id][dayIdx] = '日'
      } else {
        warnings.push(`シニアペア制約違反: ${dayIdx + 1}日にシニアスタッフが全員夜勤・公休・有給のため日勤に配置できません。シニアの夜勤回数または定休日の設定を見直してください。`)
        fallbackStatus = 'error'
      }
    }

    let dayCount = staff.filter((member) => grid[member.id][dayIdx] === '日').length
    const dayCandidates = [...staff]
      .filter((member) => canAssignDay(grid, member.id, dayIdx, maxConsecutive))
      .sort((left, right) => {
        // 余裕（personalTarget - currentOffs）が多い人を先に日勤配置
        // 夜勤後公休が多いスタッフ（余裕が少ない）が後回しになり退避公を抑制する
        const leftTarget = targetOffDays + (paidLeaveCountByStaff.get(left.id) ?? 0) + (carryOverByStaff[left.id] ?? 0)
        const rightTarget = targetOffDays + (paidLeaveCountByStaff.get(right.id) ?? 0) + (carryOverByStaff[right.id] ?? 0)
        const leftSlack = leftTarget - grid[left.id].filter((s) => isOff(s) || s === '明').length
        const rightSlack = rightTarget - grid[right.id].filter((s) => isOff(s) || s === '明').length
        return rightSlack - leftSlack
      })

    for (const candidate of dayCandidates) {
      if (dayCount >= requiredDay || dayCount >= dayLimit) break
      grid[candidate.id][dayIdx] = '日'
      dayCount += 1
    }
  }

  // Phase 4: 残スロットの公休・日勤埋め
  // 明 も休日数としてカウントし、目標休日数の過剰付与を防ぐ
  const retreatDays = new Map<string, number[]>()  // スタッフIDごとの退避公休日を集約
  for (const member of staff) {
    const target = targetOffDays + (paidLeaveCountByStaff.get(member.id) ?? 0) + (carryOverByStaff[member.id] ?? 0)
    let currentOffs = grid[member.id].filter((s) => isOff(s) || s === '明').length
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      if (grid[member.id][dayIdx] !== '') continue
      if (currentOffs < target) {
        grid[member.id][dayIdx] = '公'
        currentOffs += 1
        continue
      }

      const { dayLimit } = getDayRequirements(constraints, shiftTypes, dayIdx, year, month, bathSet, customHolidayDates)
      const currentDayCount = staff.filter((candidate) => grid[candidate.id][dayIdx] === '日').length
      if (currentDayCount < dayLimit && canAssignDay(grid, member.id, dayIdx, maxConsecutive)) {
        grid[member.id][dayIdx] = '日'
      } else {
        grid[member.id][dayIdx] = '公'
        const days = retreatDays.get(member.id) ?? []
        days.push(dayIdx + 1)
        retreatDays.set(member.id, days)
      }
    }
  }
  // 退避公休を集約して原因・対策を表示
  if (retreatDays.size > 0) {
    const totalDays = [...retreatDays.values()].reduce((s, d) => s + d.length, 0)
    const names = [...retreatDays.keys()]
      .map((id) => staff.find((m) => m.id === id)?.name ?? id)
      .slice(0, 3)
      .join('・')
    const extra = retreatDays.size > 3 ? ` 他${retreatDays.size - 3}人` : ''
    warnings.push(
      `日勤配置が上限に達したため ${names}${extra}（計${retreatDays.size}人・${totalDays}日分）が公休に退避しました。` +
      `日勤の最低配置人数が多すぎる可能性があります。配置数を減らすか、夜勤回数の設定を見直してください。`,
    )
  }

  // Phase 5: must_pair 制約の違反チェック
  const staffNameMap = new Map(staff.map((s) => [s.id, s.name]))
  for (const pair of pairConstraints) {
    if (pair.constraint_type !== 'must_pair') continue
    const nameA = staffNameMap.get(pair.staff_id_a) ?? pair.staff_id_a
    const nameB = staffNameMap.get(pair.staff_id_b) ?? pair.staff_id_b
    const ngSet = new Set<string>(['公', '夜', '明'])
    for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
      const date = new Date(year, month - 1, dayIdx + 1)
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`
      const isWeekendOrHoliday =
        date.getDay() === 0 ||
        date.getDay() === 6 ||
        HolidayJP.isHoliday(date) ||
        (customHolidayDates ?? []).includes(dateStr)
      if (isWeekendOrHoliday) continue
      const a = grid[pair.staff_id_a]?.[dayIdx]
      const b = grid[pair.staff_id_b]?.[dayIdx]
      if (a === undefined || b === undefined) continue
      // 平日のみチェック：両者とも {公・夜・明} = 日勤カバーなし → 違反
      if (ngSet.has(a) && ngSet.has(b)) {
        warnings.push(`必ペア制約: ${dayIdx + 1}日 ${nameA} / ${nameB} の日勤カバーができていません（両者とも日勤外）`)
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
