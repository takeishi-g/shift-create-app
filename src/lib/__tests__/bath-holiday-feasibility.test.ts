/**
 * 回帰テスト: 風呂日（風呂曜日）が祝日・土日に重なっても infeasible にならない（CONSTRAINTS.md §6）
 *
 * バグ（修正前）:
 *   getShiftMinimums が「祝日でも」風呂日最低人数(min_staff_bath_day)を要求していた。
 *   祝日の日勤上限は max_staff_weekend なので、min_staff_bath_day > max_staff_weekend のとき
 *   その日が「必要人数 > 上限」となり CSP 全体が即 infeasible（→貪欲フォールバック＝「解けない」）。
 *   例: カスタム祝日かつ水曜=風呂日 → 必要8人 > 上限3人。
 *
 * 修正: 風呂日最低人数は「平日のみ」適用（`isBathDay && !isWeekend`）。
 *   祝日/土日の風呂日はその日の通常の最低人数（minWeekend）に従う。
 *
 * 本テストは「風呂曜日(水)に祝日が1日重なる月」で、解が得られること・祝日の風呂日には
 * 風呂下限(8)ではなく上限内(≤max_staff_weekend)の日勤数になること・通常の風呂日(平日)では
 * きちんと8人が確保されることを検証する。修正を外すとこのテストは infeasible で失敗する。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getDay, getDaysInMonth } from 'date-fns'
import { generateShifts, SolverInput, SolverOutput } from '../shift-solver-csp'
import { generateShiftsFallback } from '../shift-solver-fallback'
import { ShiftConstraints, StaffProfile } from '@/types'

const YEAR = 2026
const MONTH = 10 // 2026-10: 水曜=10/7,14,21,28（10月の国民の祝日はスポーツの日=10/12 月のみ）
const DAYS = getDaysInMonth(new Date(YEAR, MONTH - 1))
const HOLIDAY = '2026-10-07' // 水曜（風呂曜日）に重なるカスタム祝日

function makeStaff(
  o: Partial<StaffProfile> & Pick<StaffProfile, 'id' | 'name' | 'role' | 'sort_order'>,
): StaffProfile {
  return {
    qualification: '正看護師', work_start_time: '08:30', work_end_time: '17:30',
    experience_years: 5, max_night_shifts: 8,
    hard_off_days_of_week: [], soft_off_days_of_week: [],
    hard_off_on_holidays: false, soft_off_on_holidays: false,
    allow_extra_off_days: true, is_active: true, created_at: '', updated_at: '',
    ...o,
  }
}

// 14名（夜勤あり8・日勤専従6）。師長/主任なし＝シニア制約を介在させず風呂日要因に集中する。
const STAFF: StaffProfile[] = [
  ...Array.from({ length: 8 }, (_, i) => makeStaff({ id: `n-${i + 1}`, name: `夜${i + 1}`, role: '一般', sort_order: i + 1, max_night_shifts: 8 })),
  ...Array.from({ length: 6 }, (_, i) => makeStaff({ id: `d-${i + 1}`, name: `日${i + 1}`, role: '一般', sort_order: i + 9, max_night_shifts: 0 })),
]

const CONSTRAINTS: ShiftConstraints = {
  id: 'test', year_month: '2026-10',
  min_staff_per_shift: { 日勤: 3, 夜勤: 1 },
  max_staff_per_shift: {},
  min_staff_weekend: 3, max_staff_weekend: 3,
  min_staff_bath_day: 8, // > max_staff_weekend(3) → 祝日の風呂日で min>max になる設定
  max_consecutive_work_days: 5, min_rest_hours_after_night: 0,
  auto_insert_off_after_night: true, target_off_days: 8,
  bath_days_of_week: [3], updated_at: '',
}

// route と同様に bath_days_of_week から bathDayIndices を算出（祝日を除外しない＝既定挙動）
const bathDayIndices: number[] = []
for (let i = 0; i < DAYS; i++) if (getDay(new Date(YEAR, MONTH - 1, i + 1)) === 3) bathDayIndices.push(i)

function buildInput(): SolverInput {
  return {
    yearMonth: '2026-10', staff: STAFF, constraints: CONSTRAINTS,
    leaveRequests: [], pairConstraints: [], bathDayIndices, prevMonthTail: [],
    customHolidayDates: [HOLIDAY],
  }
}

function dayCount(out: SolverOutput, idx: number): number {
  return STAFF.reduce((sum, s) => sum + ((out.grid[s.id]?.[idx] === '日') ? 1 : 0), 0)
}

describe('風呂日が祝日/土日に重なっても infeasible にならない（CONSTRAINTS.md §6）', () => {
  let out: SolverOutput
  beforeAll(async () => {
    out = await generateShifts(buildInput())
  }, 60_000)

  it('前提: 10/7 は水曜（風呂曜日）でカスタム祝日・かつ風呂日インデックスに含まれる', () => {
    expect(getDay(new Date(YEAR, MONTH - 1, 7))).toBe(3) // 水
    expect(bathDayIndices).toContain(6) // 10/7 = idx6
  })

  it('解が得られる（success）— 祝日の風呂日で min>max にならない', () => {
    expect(out.solverStatus).toBe('success')
  })

  it('祝日の風呂日(10/7)は風呂下限(8)を強制されず、土日祝の最低〜上限(min/max_staff_weekend=3)に収まる', () => {
    expect(dayCount(out, 6)).toBeGreaterThanOrEqual(3) // minWeekend は満たす
    expect(dayCount(out, 6)).toBeLessThanOrEqual(3)    // maxWeekend は超えない（風呂下限8は課されない）
  })

  it('平日の風呂日(10/14水)は従来どおり風呂下限の8人以上が確保される', () => {
    expect(getDay(new Date(YEAR, MONTH - 1, 14))).toBe(3) // 水
    // 8は最低人数。平日の風呂日では風呂下限が効くため8人以上（祝日の3人以下と明確に差が出る）。
    expect(dayCount(out, 13)).toBeGreaterThanOrEqual(8)
  })

  // 注: シニア（師長・主任）在籍月の祝日風呂日は別シナリオ。シニアペア/カバレッジ制約は
  // 土日祝をスキップするため本ルールと独立だが、必要なら別テストで拡張する。
})

// フォールバック（CSP失敗時のベストエフォート生成）も同じ「風呂日は平日のみ」ルールに従うこと。
// shift-solver-fallback.ts の getDayRequirements も対称に修正済み。祝日の風呂日が
// その日の上限(max_staff_weekend)を超えないことを保証する（風呂下限8を祝日に課さない）。
describe('フォールバックでも祝日の風呂日に風呂下限を課さない（CONSTRAINTS.md §6・CSPと対称）', () => {
  let out: SolverOutput
  beforeAll(async () => {
    out = await generateShiftsFallback(buildInput())
  }, 60_000)

  it('祝日の風呂日(10/7)の日勤数が土日祝の最低(3)〜上限(max_staff_weekend=3)に収まる', () => {
    expect(out.grid['n-1']).toBeDefined()
    expect(dayCount(out, 6)).toBeGreaterThanOrEqual(3) // minWeekend は満たす（dayCount=0 を許容しない）
    expect(dayCount(out, 6)).toBeLessThanOrEqual(3)    // 風呂下限8は祝日に課されない
  })
})
