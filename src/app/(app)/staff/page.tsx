'use client'

import { useState, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import { StaffTable } from '@/components/features/staff/StaffTable'
import { StaffFormDialog } from '@/components/features/staff/StaffFormDialog'
import { DeleteConfirmDialog } from '@/components/features/staff/DeleteConfirmDialog'
import { Input } from '@/components/ui/input'
import { StaffProfile } from '@/types'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------
const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '山田 太郎', qualification: '正看護師', role: '師長', work_start_time: '08:30', work_end_time: '17:30', experience_years: 10, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '鈴木 花子', qualification: '正看護師', role: '主任', work_start_time: '08:30', work_end_time: '17:30', experience_years: 7, max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '田中 一郎', qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 5, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-4', name: '佐藤 美咲', qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 3, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-5', name: '伊藤 健二', qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 1, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
]

let nextId = 100

type StaffFormData = {
  name: string
  qualification: StaffProfile['qualification']
  role: StaffProfile['role']
  work_start_time: string
  work_end_time: string
  experience_years: number
  max_night_shifts: number
}

export default function StaffPage() {
  const [staffList, setStaffList] = useState<StaffProfile[]>(MOCK_STAFF)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<StaffProfile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffProfile | null>(null)

  const filtered = useMemo(
    () => staffList.filter((s) => s.name.includes(search)),
    [staffList, search]
  )

  function handleAdd(data: StaffFormData) {
    const newStaff: StaffProfile = {
      id: `st-${nextId++}`,
      ...data,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setStaffList((prev) => [...prev, newStaff])
    setFormOpen(false)
  }

  function handleEdit(data: StaffFormData) {
    if (!editTarget) return
    setStaffList((prev) =>
      prev.map((s) =>
        s.id === editTarget.id
          ? { ...s, ...data, updated_at: new Date().toISOString() }
          : s
      )
    )
    setEditTarget(null)
    setFormOpen(false)
  }

  function handleDelete() {
    if (!deleteTarget) return
    setStaffList((prev) => prev.filter((s) => s.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">スタッフ管理</h1>
        <button
          onClick={() => { setEditTarget(null); setFormOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          スタッフを追加
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="名前で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white border-gray-200"
        />
      </div>

      <StaffTable
        staff={filtered}
        onEdit={(s) => { setEditTarget(s); setFormOpen(true) }}
        onDelete={(s) => setDeleteTarget(s)}
      />

      <StaffFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        onSubmit={editTarget ? handleEdit : handleAdd}
        initialData={editTarget}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        targetName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
