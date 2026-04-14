'use client'

import { useState, useEffect } from 'react'
import { StaffProfile, StaffQualification, StaffRole, WorkHoursType } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface StaffFormData {
  name: string
  qualification: StaffQualification
  role: StaffRole
  work_hours_type: WorkHoursType
  experience_years: number
  max_hours_per_month: number
  max_night_shifts: number
}

interface StaffFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: StaffFormData) => void
  initialData?: Partial<StaffProfile> | null
}

const defaultForm: StaffFormData = {
  name: '',
  qualification: '正看護師',
  role: '一般',
  work_hours_type: 'AM',
  experience_years: 0,
  max_hours_per_month: 160,
  max_night_shifts: 8,
}

export function StaffFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
}: StaffFormDialogProps) {
  const [form, setForm] = useState<StaffFormData>(defaultForm)
  const isEdit = !!initialData?.id

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          name: initialData.name ?? '',
          qualification: initialData.qualification ?? '正看護師',
          role: initialData.role ?? '一般',
          work_hours_type: initialData.work_hours_type ?? 'AM',
          experience_years: initialData.experience_years ?? 0,
          max_hours_per_month: initialData.max_hours_per_month ?? 160,
          max_night_shifts: initialData.max_night_shifts ?? 8,
        })
      } else {
        setForm(defaultForm)
      }
    }
  }, [open, initialData])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'スタッフを編集' : 'スタッフを追加'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* 氏名 */}
          <div className="space-y-1.5">
            <Label htmlFor="name">氏名 <span className="text-red-500">*</span></Label>
            <Input
              id="name"
              placeholder="例: 山田 太郎"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          {/* 資格・役職（2列） */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>資格</Label>
              <Select
                value={form.qualification}
                onValueChange={(v) => v && setForm({ ...form, qualification: v as StaffQualification })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="正看護師">正看護師</SelectItem>
                  <SelectItem value="准看護師">准看護師</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>役職</Label>
              <Select
                value={form.role}
                onValueChange={(v) => v && setForm({ ...form, role: v as StaffRole })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="師長">師長</SelectItem>
                  <SelectItem value="主任">主任</SelectItem>
                  <SelectItem value="一般">一般</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 勤務時間帯 */}
          <div className="space-y-1.5">
            <Label>勤務時間帯</Label>
            <Select
              value={form.work_hours_type}
              onValueChange={(v) => v && setForm({ ...form, work_hours_type: v as WorkHoursType })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM（日勤・早番帯）</SelectItem>
                <SelectItem value="PM">PM（遅番・夕方帯）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 経験年数・月間最大夜勤回数（2列） */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="exp">経験年数（年）</Label>
              <Input
                id="exp"
                type="number"
                min={0}
                max={50}
                value={form.experience_years}
                onChange={(e) => setForm({ ...form, experience_years: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="night">月間最大夜勤回数</Label>
              <Input
                id="night"
                type="number"
                min={0}
                max={20}
                value={form.max_night_shifts}
                onChange={(e) => setForm({ ...form, max_night_shifts: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* 月間最大勤務時間 */}
          <div className="space-y-1.5">
            <Label htmlFor="hours">月間最大勤務時間（h）</Label>
            <Input
              id="hours"
              type="number"
              min={0}
              max={300}
              value={form.max_hours_per_month}
              onChange={(e) => setForm({ ...form, max_hours_per_month: Number(e.target.value) })}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="submit"
              className="bg-rose-500 hover:bg-rose-600 text-white"
              disabled={!form.name.trim()}
            >
              {isEdit ? '更新する' : '追加する'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
