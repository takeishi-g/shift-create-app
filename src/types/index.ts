// =============================
// スタッフ
// =============================

/** 資格区分 */
export type StaffQualification = '正看護師' | '准看護師'

/** 役職 */
export type StaffRole = '師長' | '主任' | '一般'

export interface StaffProfile {
  id: string
  name: string
  qualification: StaffQualification
  role: StaffRole
  /** 勤務開始時刻（例: "08:30"）。日勤AM/PM分類に使用 */
  work_start_time: string
  /** 勤務終了時刻（例: "17:30"）*/
  work_end_time: string
  max_night_shifts: number
  experience_years: number
  /** hard制約の定休曜日（0=日〜6=土）- シフト不可 */
  hard_off_days_of_week: number[]
  /** soft制約の定休曜日（0=日〜6=土）- できれば休み */
  soft_off_days_of_week: number[]
  /** hard制約: 祝日を定休にするか */
  hard_off_on_holidays: boolean
  /** soft制約: 祝日を定休にするか */
  soft_off_on_holidays: boolean
  /** 定休日以外に公休を入れるか（false の場合、定休日のみ休日、目標休日数への追加配分なし） */
  allow_extra_off_days: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** work_start_time から AM/PM を導出するユーティリティ */
export function deriveWorkHoursType(work_start_time: string): 'AM' | 'PM' {
  return work_start_time < '12:00' ? 'AM' : 'PM'
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
// お風呂の日
// =============================
export type BathDayPattern = 'weekly' | 'date'

export interface BathDay {
  id: string
  year: number
  month: number
  /** weekly: 曜日指定（0=日〜6=土）, date: 日付指定 */
  pattern: BathDayPattern
  day_of_week: number | null  // weekly の場合
  date: number | null         // date の場合
  created_at: string
}

// =============================
// 勤務制約
// =============================
export interface ShiftConstraints {
  id: string
  year_month: string | null
  /** シフト種別IDごとの最低配置人数 */
  min_staff_per_shift: Record<string, number>
  /** シフト種別IDごとの最高配置人数 */
  max_staff_per_shift: Record<string, number>
  /** 土日祝の最低配置人数 */
  min_staff_weekend: number
  /** 土日祝の最高配置人数 */
  max_staff_weekend: number
  /** お風呂の日の最低配置人数 */
  min_staff_bath_day: number
  max_consecutive_work_days: number
  min_rest_hours_after_night: number
  auto_insert_off_after_night: boolean
  target_off_days: number
  /** お風呂の曜日（0=日〜6=土）*/
  bath_days_of_week: number[]
  updated_at: string
}

// =============================
// ペア制約
// =============================
export type PairConstraintType = 'must_pair' | 'must_not_pair' | 'senior_pair'

export interface StaffPairConstraint {
  id: string
  staff_id_a: string
  staff_id_b: string
  constraint_type: PairConstraintType
  shift_type_id: string | null
  shift_type?: Pick<ShiftType, 'id' | 'name' | 'is_overnight' | 'is_off'>
  note: string | null
  created_at: string
}

// =============================
// 勤務希望（希望休・シフト希望）
// =============================
export type LeaveType = '希望休' | '有給' | '特別休暇' | 'シフト希望' | '他'

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
// 繰越休日
// =============================
export interface StaffCarryOver {
  id: string
  staff_id: string
  from_month: string
  to_month: string
  carry_over_days: number
  created_at: string
}

// =============================
// カスタム休日
// =============================
export interface CustomHoliday {
  id: string
  /** YYYY-MM-DD */
  date: string
  name: string
  created_at: string
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
