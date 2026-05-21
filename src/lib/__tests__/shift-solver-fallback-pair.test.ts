import { describe, it, expect } from 'vitest'
import { generateShiftsFallback } from '../shift-solver-fallback'
import type { SolverInput, ShiftGrid } from '../shift-solver'
import type { ShiftConstraints, ShiftType, StaffPairConstraint, StaffProfile } from '@/types'

// ──────────────────────────────────────────────
// フィクスチャ
// ──────────────────────────────────────────────

const NIGHT_TYPE: ShiftType = {
  id: 'night-type',
  name: '夜勤',
  start_time: '16:30',
  end_time: '09:00',
  is_overnight: true,
  is_off: false,
  color: '#333',
  display_order: 1,
  created_at: '2026-01-01T00:00:00Z',
}

const DAY_TYPE: ShiftType = {
  id: 'day-type',
  name: '日勤',
  start_time: '08:30',
  end_time: '17:30',
  is_overnight: false,
  is_off: false,
  color: '#fff',
  display_order: 0,
  created_at: '2026-01-01T00:00:00Z',
}

function makeStaff(id: string, overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    id,
    name: `スタッフ_${id}`,
    qualification: '正看護師',
    role: '一般',
    work_start_time: '08:30',
    work_end_time: '17:30',
    max_night_shifts: 6,
    experience_years: 3,
    off_days_of_week: [],
    off_on_holidays: false,
    off_days_constraint: 'soft',
    allow_extra_off_days: true,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const BASE_CONSTRAINTS: ShiftConstraints = {
  id: 'c1',
  year_month: '2026-06',
  min_staff_per_shift: { '夜勤': 2, '日勤': 2 },
  max_staff_per_shift: { '夜勤': 3, '日勤': 5 },
  min_staff_weekend: 2,
  max_staff_weekend: 4,
  min_staff_bath_day: 3,
  max_consecutive_work_days: 5,
  min_rest_hours_after_night: 16,
  auto_insert_off_after_night: true,
  target_off_days: 8,
  bath_days_of_week: [],
  updated_at: '2026-01-01T00:00:00Z',
}

// staff-a と staff-b がテスト対象ペア、残り3名はペア制約なし
const ALL_STAFF: StaffProfile[] = [
  makeStaff('staff-a'),
  makeStaff('staff-b'),
  makeStaff('staff-c'),
  makeStaff('staff-d'),
  makeStaff('staff-e'),
]

function makeBaseInput(pairConstraints: StaffPairConstraint[]): SolverInput {
  return {
    yearMonth: '2026-06',
    staff: ALL_STAFF,
    constraints: BASE_CONSTRAINTS,
    leaveRequests: [],
    pairConstraints,
    shiftTypes: [NIGHT_TYPE, DAY_TYPE],
    bathDayIndices: [],
  }
}

function makePairConstraint(overrides: Partial<StaffPairConstraint> = {}): StaffPairConstraint {
  return {
    id: 'pair-1',
    staff_id_a: 'staff-a',
    staff_id_b: 'staff-b',
    constraint_type: 'must_not_pair',
    shift_type_id: null,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────

function hasPairViolation(
  grid: ShiftGrid,
  idA: string,
  idB: string,
  code: '夜' | '日',
  daysInMonth: number,
): boolean {
  for (let d = 0; d < daysInMonth; d++) {
    if (grid[idA][d] === code && grid[idB][d] === code) return true
  }
  return false
}

// ──────────────────────────────────────────────
// テスト
// ──────────────────────────────────────────────

describe('generateShiftsFallback — must_not_pair 制約', () => {
  const DAYS = 30 // 2026-06 は30日

  it('ペア制約なしのとき正常に生成できる（ベースライン）', async () => {
    const result = await generateShiftsFallback(makeBaseInput([]))
    expect(result.solverStatus).toBe('success')
    expect(result.grid['staff-a']).toHaveLength(DAYS)
  })

  it('全シフト対象のペア禁止: staff-a と staff-b が同日夜勤にならない', async () => {
    const constraint = makePairConstraint({ shift_type_id: null })
    const result = await generateShiftsFallback(makeBaseInput([constraint]))

    expect(result.solverStatus).toBe('success')
    expect(hasPairViolation(result.grid, 'staff-a', 'staff-b', '夜', DAYS)).toBe(false)
  })

  it('全シフト対象のペア禁止: staff-a と staff-b が同日日勤にならない', async () => {
    const constraint = makePairConstraint({ shift_type_id: null })
    const result = await generateShiftsFallback(makeBaseInput([constraint]))

    expect(result.solverStatus).toBe('success')
    expect(hasPairViolation(result.grid, 'staff-a', 'staff-b', '日', DAYS)).toBe(false)
  })

  it('夜勤専用ペア禁止: 夜勤で違反しない', async () => {
    const constraint = makePairConstraint({
      shift_type_id: NIGHT_TYPE.id,
      shift_type: { id: NIGHT_TYPE.id, name: NIGHT_TYPE.name, is_overnight: true, is_off: false },
    })
    const result = await generateShiftsFallback(makeBaseInput([constraint]))

    expect(result.solverStatus).toBe('success')
    expect(hasPairViolation(result.grid, 'staff-a', 'staff-b', '夜', DAYS)).toBe(false)
  })

  it('日勤専用ペア禁止: 日勤で違反しない', async () => {
    const constraint = makePairConstraint({
      shift_type_id: DAY_TYPE.id,
      shift_type: { id: DAY_TYPE.id, name: DAY_TYPE.name, is_overnight: false, is_off: false },
    })
    const result = await generateShiftsFallback(makeBaseInput([constraint]))

    expect(result.solverStatus).toBe('success')
    expect(hasPairViolation(result.grid, 'staff-a', 'staff-b', '日', DAYS)).toBe(false)
  })

  it('日勤専用ペア禁止: 日勤違反が発生しない（夜勤はスコープ外）', async () => {
    const constraint = makePairConstraint({
      shift_type_id: DAY_TYPE.id,
      shift_type: { id: DAY_TYPE.id, name: DAY_TYPE.name, is_overnight: false, is_off: false },
    })
    const result = await generateShiftsFallback(makeBaseInput([constraint]))

    expect(result.solverStatus).toBe('success')
    // 日勤専用制約なので日勤ペアは許容されない
    expect(hasPairViolation(result.grid, 'staff-a', 'staff-b', '日', DAYS)).toBe(false)
    // 夜勤はこの制約のスコープ外（夜勤ペアが発生しても制約違反ではない）
  })
})
