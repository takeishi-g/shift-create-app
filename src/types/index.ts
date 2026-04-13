// =============================
// スタッフ
// =============================
export type EmploymentType = 'full_time' | 'part_time' | 'dispatch'

export interface StaffProfile {
  id: string
  name: string
  employment_type: EmploymentType
  max_hours_per_month: number
  max_night_shifts: number
  experience_years: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// =============================
// シフト種別
// =============================
export interface ShiftType {
  id: string
  name: string
  start_time: string | null
  end_time: string | null
  is_overnight: boolean
  is_off: boolean
  color: string
  display_order: number
  created_at: string
}

// =============================
// 勤務制約
// =============================
export interface ShiftConstraints {
  id: string
  min_staff_per_shift: Record<string, number>
  max_consecutive_work_days: number
  min_rest_hours_after_night: number
  auto_insert_off_after_night: boolean
  max_night_shifts_per_month: number
  updated_at: string
}

// =============================
// ペア制約
// =============================
export type PairConstraintType = 'must_pair' | 'must_not_pair'

export interface StaffPairConstraint {
  id: string
  staff_id_a: string
  staff_id_b: string
  constraint_type: PairConstraintType
  shift_type_id: string | null
  note: string | null
  created_at: string
}

// =============================
// 希望休・有給申請
// =============================
export type LeaveType = '希望休' | '有給' | '特別休暇' | 'シフト希望'

export interface LeaveRequest {
  id: string
  staff_id: string
  date: string
  type: LeaveType
  /** type = 'シフト希望' の場合に希望するシフト種別ID。それ以外は null */
  preferred_shift_type_id: string | null
  note: string | null
  created_at: string
  updated_at: string
  staff?: StaffProfile
  preferred_shift_type?: ShiftType
}

// =============================
// シフト割り当て
// =============================
export interface ScheduleMonth {
  id: string
  year: number
  month: number
  status: 'draft' | 'published'
  generated_at: string | null
  created_by: string
  created_at: string
}

export interface ShiftAssignment {
  id: string
  schedule_month_id: string
  staff_id: string
  date: string
  shift_type_id: string
  is_auto_generated: boolean
  note: string | null
  created_at: string
  updated_at: string
  staff?: StaffProfile
  shift_type?: ShiftType
}
