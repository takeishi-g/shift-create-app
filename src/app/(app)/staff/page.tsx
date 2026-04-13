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
interface Skill { id: string; name: string }
interface StaffWithSkills extends StaffProfile { skills: Skill[] }

const MOCK_SKILLS: Skill[] = [
  { id: 'sk-1', name: 'ICU対応' },
  { id: 'sk-2', name: '救急リーダー' },
  { id: 'sk-3', name: 'NICU対応' },
]

const MOCK_STAFF: StaffWithSkills[] = [
  { id: 'st-1', name: '山田 太郎', employment_type: 'full_time', experience_years: 5, max_hours_per_month: 160, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '', skills: [MOCK_SKILLS[0]] },
  { id: 'st-2', name: '鈴木 花子', employment_type: 'part_time', experience_years: 2, max_hours_per_month: 100, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '', skills: [] },
  { id: 'st-3', name: '田中 一郎', employment_type: 'full_time', experience_years: 8, max_hours_per_month: 160, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '', skills: [MOCK_SKILLS[0], MOCK_SKILLS[1]] },
  { id: 'st-4', name: '佐藤 美咲', employment_type: 'dispatch', experience_years: 3, max_hours_per_month: 120, max_night_shifts: 6, is_active: true, created_at: '', updated_at: '', skills: [] },
  { id: 'st-5', name: '伊藤 健二', employment_type: 'full_time', experience_years: 1, max_hours_per_month: 160, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '', skills: [] },
]

let nextId = 100

export default function StaffPage() {
  const [staffList, setStaffList] = useState<StaffWithSkills[]>(MOCK_STAFF)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<StaffWithSkills | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffWithSkills | null>(null)

  const filtered = useMemo(
    () => staffList.filter((s) => s.name.includes(search)),
    [staffList, search]
  )

  function handleAdd(data: { name: string; employment_type: string; experience_years: number; max_hours_per_month: number; max_night_shifts: number; skill_ids: string[] }) {
    const skills = MOCK_SKILLS.filter((sk) => data.skill_ids.includes(sk.id))
    const newStaff: StaffWithSkills = {
      id: `st-${nextId++}`,
      name: data.name,
      employment_type: data.employment_type as StaffProfile['employment_type'],
      experience_years: data.experience_years,
      max_hours_per_month: data.max_hours_per_month,
      max_night_shifts: data.max_night_shifts,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      skills,
    }
    setStaffList((prev) => [...prev, newStaff])
    setFormOpen(false)
  }

  function handleEdit(data: { name: string; employment_type: string; experience_years: number; max_hours_per_month: number; max_night_shifts: number; skill_ids: string[] }) {
    if (!editTarget) return
    const skills = MOCK_SKILLS.filter((sk) => data.skill_ids.includes(sk.id))
    setStaffList((prev) =>
      prev.map((s) =>
        s.id === editTarget.id
          ? { ...s, ...data, employment_type: data.employment_type as StaffProfile['employment_type'], skills, updated_at: new Date().toISOString() }
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
    <div className="space-y-5">
      {/* ページヘッダー */}
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

      {/* 検索バー */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="名前で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white border-gray-200"
        />
      </div>

      {/* テーブル */}
      <StaffTable
        staff={filtered}
        onEdit={(s) => { setEditTarget(s); setFormOpen(true) }}
        onDelete={(s) => setDeleteTarget(s)}
      />

      {/* 追加・編集ダイアログ */}
      <StaffFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        onSubmit={editTarget ? handleEdit : handleAdd}
        initialData={editTarget}
        availableSkills={MOCK_SKILLS}
      />

      {/* 削除確認ダイアログ */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        targetName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
