'use client'

import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { StaffProfile, ShiftType } from '@/types'
import { LeaveRequestTable, LeaveRequestWithStatus } from '@/components/features/leave-requests/LeaveRequestTable'
import { LeaveRequestFormDialog } from '@/components/features/leave-requests/LeaveRequestFormDialog'
import { DeleteConfirmDialog } from '@/components/features/staff/DeleteConfirmDialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------
const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '山田 太郎', qualification: '正看護師', role: '師長', work_start_time: '08:30', work_end_time: '17:30', experience_years: 5,  max_night_shifts: 8, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '鈴木 花子', qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 2,  max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '田中 一郎', qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 8,  max_night_shifts: 8, is_active: true, created_at: '', updated_at: '' },
]

const MOCK_SHIFT_TYPES: ShiftType[] = [
  { id: 'sh-1', name: '早番', start_time: '07:00', end_time: '16:00', is_overnight: false, is_off: false, color: '#3B82F6', display_order: 1, created_at: '' },
  { id: 'sh-2', name: '日勤', start_time: '09:00', end_time: '18:00', is_overnight: false, is_off: false, color: '#10B981', display_order: 2, created_at: '' },
  { id: 'sh-3', name: '夜勤', start_time: '21:00', end_time: '09:00', is_overnight: true, is_off: false, color: '#6366F1', display_order: 3, created_at: '' },
]

const MOCK_REQUESTS: LeaveRequestWithStatus[] = [
  {
    id: 'lr-1', staff_id: 'st-1', date: '2025-04-15', type: '希望休',
    preferred_shift_type_id: null, note: null, status: 'approved',
    created_at: '', updated_at: '',
    staff: MOCK_STAFF[0],
  },
  {
    id: 'lr-2', staff_id: 'st-2', date: '2025-04-20', type: '有給',
    preferred_shift_type_id: null, note: '私用のため', status: 'pending',
    created_at: '', updated_at: '',
    staff: MOCK_STAFF[1],
  },
  {
    id: 'lr-3', staff_id: 'st-3', date: '2025-04-23', type: 'シフト希望',
    preferred_shift_type_id: 'sh-3', note: null, status: 'approved',
    created_at: '', updated_at: '',
    staff: MOCK_STAFF[2],
    preferred_shift_type: MOCK_SHIFT_TYPES[2],
  },
]

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, '0')
  return { value: `2025-${month}`, label: `2025年${i + 1}月` }
})

let nextId = 100

export default function LeaveRequestsPage() {
  const [requests, setRequests] = useState<LeaveRequestWithStatus[]>(MOCK_REQUESTS)
  const [selectedMonth, setSelectedMonth] = useState('2025-04')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LeaveRequestWithStatus | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeaveRequestWithStatus | null>(null)

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const matchMonth = r.date.startsWith(selectedMonth)
      const matchStatus = statusFilter === 'all' || r.status === statusFilter
      return matchMonth && matchStatus
    })
  }, [requests, selectedMonth, statusFilter])

  function handleAdd(data: {
    staff_id: string; date: string; type: LeaveRequestWithStatus['type']
    preferred_shift_type_id: string | null; status: LeaveRequestWithStatus['status']; note: string
  }) {
    const staff = MOCK_STAFF.find((s) => s.id === data.staff_id)
    const preferred_shift_type = MOCK_SHIFT_TYPES.find((st) => st.id === data.preferred_shift_type_id)
    const newReq: LeaveRequestWithStatus = {
      id: `lr-${nextId++}`,
      staff_id: data.staff_id,
      date: data.date,
      type: data.type,
      preferred_shift_type_id: data.preferred_shift_type_id,
      note: data.note || null,
      status: data.status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      staff,
      preferred_shift_type,
    }
    setRequests((prev) => [...prev, newReq])
    setFormOpen(false)
  }

  function handleEdit(data: {
    staff_id: string; date: string; type: LeaveRequestWithStatus['type']
    preferred_shift_type_id: string | null; status: LeaveRequestWithStatus['status']; note: string
  }) {
    if (!editTarget) return
    const staff = MOCK_STAFF.find((s) => s.id === data.staff_id)
    const preferred_shift_type = MOCK_SHIFT_TYPES.find((st) => st.id === data.preferred_shift_type_id)
    setRequests((prev) =>
      prev.map((r) =>
        r.id === editTarget.id
          ? {
              ...r,
              ...data,
              note: data.note || null,
              updated_at: new Date().toISOString(),
              staff,
              preferred_shift_type,
            }
          : r
      )
    )
    setEditTarget(null)
    setFormOpen(false)
  }

  function handleDelete() {
    if (!deleteTarget) return
    setRequests((prev) => prev.filter((r) => r.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">希望休管理</h1>
        <button
          onClick={() => { setEditTarget(null); setFormOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          希望休を追加
        </button>
      </div>

      {/* フィルター */}
      <div className="flex items-center gap-3">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[160px] bg-white border-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[160px] bg-white border-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ステータス: 全て</SelectItem>
            <SelectItem value="pending">申請中</SelectItem>
            <SelectItem value="approved">承認済み</SelectItem>
            <SelectItem value="rejected">却下</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* テーブル */}
      <LeaveRequestTable
        requests={filtered}
        onEdit={(r) => { setEditTarget(r); setFormOpen(true) }}
        onDelete={(r) => setDeleteTarget(r)}
      />

      {/* 追加・編集ダイアログ */}
      <LeaveRequestFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        onSubmit={editTarget ? handleEdit : handleAdd}
        initialData={editTarget}
        staffList={MOCK_STAFF}
        shiftTypes={MOCK_SHIFT_TYPES}
      />

      {/* 削除確認ダイアログ */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        targetName={deleteTarget?.staff?.name ? `${deleteTarget.staff.name}の${deleteTarget.date}申請` : ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
