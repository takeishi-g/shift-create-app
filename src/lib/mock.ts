// TODO: Supabase 接続後に各ファイルのインポートを削除し、API から取得するよう差し替える
import { StaffProfile, ShiftType } from '@/types'

export const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '武石 恵沙美', qualification: '正看護師', role: '師長', work_start_time: '08:30', work_end_time: '17:30', experience_years: 15, max_night_shifts: 2, off_days_of_week: [], off_on_holidays: false, off_days_constraint: 'hard', is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '前川 さゆり', qualification: '正看護師', role: '主任', work_start_time: '08:30', work_end_time: '17:30', experience_years: 12, max_night_shifts: 4, off_days_of_week: [], off_on_holidays: false, off_days_constraint: 'hard', is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '広瀬 澪楽',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 8,  max_night_shifts: 6, off_days_of_week: [], off_on_holidays: false, off_days_constraint: 'hard', is_active: true, created_at: '', updated_at: '' },
  { id: 'st-4', name: '堀 奈々美',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 6,  max_night_shifts: 6, off_days_of_week: [], off_on_holidays: false, off_days_constraint: 'hard', is_active: true, created_at: '', updated_at: '' },
  { id: 'st-5', name: '伊藤 健二',  qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 4,  max_night_shifts: 4, off_days_of_week: [], off_on_holidays: false, off_days_constraint: 'hard', is_active: true, created_at: '', updated_at: '' },
]

export const MOCK_SHIFT_TYPES: ShiftType[] = [
  { id: 'sh-1', name: '早番', start_time: '07:00', end_time: '16:00', is_overnight: false, is_off: false, color: '#3B82F6', display_order: 1, created_at: '' },
  { id: 'sh-2', name: '日勤', start_time: '09:00', end_time: '18:00', is_overnight: false, is_off: false, color: '#10B981', display_order: 2, created_at: '' },
  { id: 'sh-3', name: '夜勤', start_time: '21:00', end_time: '09:00', is_overnight: true,  is_off: false, color: '#6366F1', display_order: 3, created_at: '' },
]
