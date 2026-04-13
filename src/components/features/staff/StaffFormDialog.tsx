'use client'

import { useState, useEffect } from 'react'
import { StaffProfile } from '@/types'
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
import { Checkbox } from '@/components/ui/checkbox'

interface Skill {
  id: string
  name: string
}

interface StaffFormData {
  name: string
  employment_type: string
  experience_years: number
  max_hours_per_month: number
  max_night_shifts: number
  skill_ids: string[]
}

interface StaffFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: StaffFormData) => void
  initialData?: (Partial<StaffProfile> & { skills?: Skill[] }) | null
  availableSkills: Skill[]
}

const defaultForm: StaffFormData = {
  name: '',
  employment_type: 'full_time',
  experience_years: 0,
  max_hours_per_month: 160,
  max_night_shifts: 8,
  skill_ids: [],
}

export function StaffFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  availableSkills,
}: StaffFormDialogProps) {
  const [form, setForm] = useState<StaffFormData>(defaultForm)
  const isEdit = !!initialData?.id

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          name: initialData.name ?? '',
          employment_type: initialData.employment_type ?? 'full_time',
          experience_years: initialData.experience_years ?? 0,
          max_hours_per_month: initialData.max_hours_per_month ?? 160,
          max_night_shifts: initialData.max_night_shifts ?? 8,
          skill_ids: initialData.skills?.map((s) => s.id) ?? [],
        })
      } else {
        setForm(defaultForm)
      }
    }
  }, [open, initialData])

  function toggleSkill(skillId: string) {
    setForm((prev) => ({
      ...prev,
      skill_ids: prev.skill_ids.includes(skillId)
        ? prev.skill_ids.filter((id) => id !== skillId)
        : [...prev.skill_ids, skillId],
    }))
  }

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

          {/* 雇用形態 */}
          <div className="space-y-1.5">
            <Label>雇用形態</Label>
            <Select
              value={form.employment_type}
              onValueChange={(v) => v && setForm({ ...form, employment_type: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">正社員</SelectItem>
                <SelectItem value="part_time">パート</SelectItem>
                <SelectItem value="dispatch">契約社員</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 経験年数・月間上限（2列） */}
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

          {/* スキル */}
          {availableSkills.length > 0 && (
            <div className="space-y-2">
              <Label>スキル</Label>
              <div className="flex flex-wrap gap-3">
                {availableSkills.map((skill) => (
                  <label
                    key={skill.id}
                    className="flex items-center gap-1.5 cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={form.skill_ids.includes(skill.id)}
                      onCheckedChange={() => toggleSkill(skill.id)}
                    />
                    {skill.name}
                  </label>
                ))}
              </div>
            </div>
          )}

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
