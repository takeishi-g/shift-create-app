/**
 * 定休スタッフの夜勤を定休に隣接配置する（夜勤分散=均等化ルールの免除）リグレッションテスト
 *
 * 背景（docs/CONSTRAINTS.md §5「夜勤ありスタッフの定休日活用」）:
 *   定休あり＋夜勤ありのスタッフは「夜(X-2)→明(X-1)→公(X=定休)」に整合させ、
 *   夜勤後の必須公休(post_night_off)を定休日に重ねて余分な公休を出さない。
 *
 * 実データの不具合（2026-08 対象＝師長プロファイル）:
 *   希望夜勤 8/20 が固定され、夜勤分散(minGap=14)が自動夜勤を 8/1〜8/5 に押し込み、
 *   定休2日前(木)に置けず平日に余分な公休が発生（公休 11→12）。
 *   → 定休スタッフを均等化から免除すれば、既存の定休誘導(-15)が自動夜勤を木曜へ寄せて根治する。
 *
 * 本テストは当該師長と同一プロファイル（夜勤上限2・定休=日土・祝定休・定休外公休不可）の師長クローンを
 * 2026-08 のカレンダー＋8/20 夜勤希望ピンで再生成し、両方の夜勤が定休に整合し余分な公休が
 * 出ないことを検証する。免除を外すと（夜勤分散が復活すると）このテストは失敗する。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import HolidayJP from '@holiday-jp/holiday_jp'
import { generateShifts, SolverInput, SolverOutput } from '../shift-solver-csp'
import { LeaveRequest, ShiftConstraints, ShiftType, StaffProfile } from '@/types'

const YEAR = 2026
const MONTH = 8
const DAYS = 31 // 2026-08

function makeStaff(
  o: Partial<StaffProfile> & Pick<StaffProfile, 'id' | 'name' | 'role' | 'sort_order'>,
): StaffProfile {
  return {
    qualification: '正看護師',
    work_start_time: '08:30',
    work_end_time: '17:30',
    experience_years: 5,
    max_night_shifts: 8,
    hard_off_days_of_week: [],
    soft_off_days_of_week: [],
    hard_off_on_holidays: false,
    soft_off_on_holidays: false,
    allow_extra_off_days: true,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...o,
  }
}

// 師長クローン = 当該師長相当（夜勤上限2・定休=日(0)土(6)・祝定休・定休外公休を許さない）
const STAFF: StaffProfile[] = [
  makeStaff({
    id: 'sn-1', name: '師長', role: '師長', sort_order: 1,
    max_night_shifts: 2,
    hard_off_days_of_week: [0, 6],
    hard_off_on_holidays: true,
    allow_extra_off_days: false,
  }),
  makeStaff({ id: 'sn-2', name: '主任', role: '主任', sort_order: 2, max_night_shifts: 4 }),
  ...Array.from({ length: 8 }, (_, i) =>
    makeStaff({ id: `g-${i + 1}`, name: `一般${i + 1}`, role: '一般', sort_order: i + 3 }),
  ),
]

const CONSTRAINTS: ShiftConstraints = {
  id: 'test',
  year_month: '2026-08',
  min_staff_per_shift: { 日勤: 3, 夜勤: 2 },
  max_staff_per_shift: {},
  min_staff_weekend: 2,
  max_staff_weekend: 2,
  min_staff_bath_day: 3,
  max_consecutive_work_days: 5,
  min_rest_hours_after_night: 0,
  auto_insert_off_after_night: true,
  target_off_days: 10,
  bath_days_of_week: [],
  updated_at: '',
}

const NIGHT_TYPE: ShiftType = {
  id: 'st-night', name: '夜勤',
  start_time: '16:30', end_time: '09:00',
  is_overnight: true, is_off: false,
  color: '#1f2937', display_order: 4, created_at: '',
}

// 当該師長の実データと同じ: 8/20(木) に「シフト希望＝夜勤」
const PREF_NIGHT_8_20: LeaveRequest = {
  id: 'lr-1', staff_id: 'sn-1', date: '2026-08-20', type: 'シフト希望',
  preferred_shift_type_id: 'st-night', note: null, created_at: '', updated_at: '',
  preferred_shift_type: NIGHT_TYPE,
}

function buildInput(): SolverInput {
  return {
    yearMonth: '2026-08',
    staff: STAFF,
    constraints: CONSTRAINTS,
    leaveRequests: [PREF_NIGHT_8_20],
    pairConstraints: [],
    bathDayIndices: [],
    prevMonthTail: [],
  }
}

// その日（0始まりインデックス）が師長の定休日か（日土 or 祝日）
function isHardOff(dayIdx: number): boolean {
  const d = new Date(YEAR, MONTH - 1, dayIdx + 1)
  return d.getDay() === 0 || d.getDay() === 6 || HolidayJP.isHoliday(d)
}

describe('定休スタッフの夜勤は定休に隣接配置される（均等化免除・CONSTRAINTS.md §5）', () => {
  let out: SolverOutput

  beforeAll(async () => {
    out = await generateShifts(buildInput())
  }, 60_000)

  it('解が得られる（success）', () => {
    expect(out.solverStatus).toBe('success')
  })

  it('師長の夜勤はちょうど2回・うち1回は希望の8/20(idx19)', () => {
    const row = out.grid['sn-1']
    const nights = row.map((c, i) => (c === '夜' ? i : -1)).filter((i) => i >= 0)
    expect(nights.length).toBe(2)
    expect(nights).toContain(19) // 8/20
  })

  it('全ての夜勤で「2日後が定休」に整合する（夜→明→公=定休）', () => {
    const row = out.grid['sn-1']
    const nights = row.map((c, i) => (c === '夜' ? i : -1)).filter((i) => i >= 0)
    expect(nights.length).toBeGreaterThan(0)
    for (const d of nights) {
      // 月末夜勤(d+2 が月外)は翌月の明け・公休として prevMonthTail 側で処理されるため
      // 当月の整合判定からは除外（境界を明示）。余分な公休の有無は次の公休数テストで担保される。
      if (d + 2 >= DAYS) continue
      // post_night_off の公休(d+2)が師長の定休日と重なる＝余分な公休を生まない
      expect(isHardOff(d + 2), `夜勤 idx=${d} の2日後(idx=${d + 2})が定休でない`).toBe(true)
    }
  })

  it('余分な公休が出ない（公休数＝定休日数）', () => {
    const row = out.grid['sn-1']
    const offCount = row.filter((c) => c === '公').length
    const definedOff = Array.from({ length: DAYS }, (_, i) => i).filter(isHardOff).length
    // 均等化が復活すると自動夜勤が定休に整合できず、平日に余分な公休が付いて offCount > definedOff になる
    expect(offCount).toBe(definedOff)
  })
})
