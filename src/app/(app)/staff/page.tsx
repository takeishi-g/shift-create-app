'use client'

import { useState, useMemo, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { StaffTable } from '@/components/features/staff/StaffTable'
import { StaffFormDialog } from '@/components/features/staff/StaffFormDialog'
import { DeleteConfirmDialog } from '@/components/features/staff/DeleteConfirmDialog'
import { Input } from '@/components/ui/input'
import { StaffProfile } from '@/types'
import { createClient } from '@/lib/supabase/client'

type StaffFormData = {
  name: string
  qualification: StaffProfile['qualification']
  role: StaffProfile['role']
  work_start_time: string
  work_end_time: string
  experience_years: number
  max_night_shifts: number
  off_days_of_week: number[]
  off_on_holidays: boolean
  off_days_constraint: StaffProfile['off_days_constraint']
}

export default function StaffPage() {
  const [staffList, setStaffList] = useState<StaffProfile[]>([])
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<StaffProfile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('is_active', true)
        .order('created_at')
      if (data) setStaffList(data)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(
    () => staffList.filter((s) => s.name.includes(search)),
    [staffList, search]
  )

  async function handleAdd(data: StaffFormData) {
    const { data: inserted } = await supabase
      .from('staff_profiles')
      .insert({ ...data, is_active: true })
      .select()
      .single()
    if (inserted) setStaffList((prev) => [...prev, inserted])
    setFormOpen(false)
  }

  async function handleEdit(data: StaffFormData) {
    if (!editTarget) return
    const { data: updated } = await supabase
      .from('staff_profiles')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', editTarget.id)
      .select()
      .single()
    if (updated) setStaffList((prev) => prev.map((s) => s.id === editTarget.id ? updated : s))
    setEditTarget(null)
    setFormOpen(false)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.from('staff_profiles').update({ is_active: false }).eq('id', deleteTarget.id)
    setStaffList((prev) => prev.filter((s) => s.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">読み込み中...</div>

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
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
