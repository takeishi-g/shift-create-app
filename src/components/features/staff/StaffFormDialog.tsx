'use client'

import { useState, useEffect } from 'react'
import { StaffProfile, StaffQualification, StaffRole } from '@/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  work_start_time: string
  work_end_time: string
  experience_years: number
  max_night_shifts: number
  hard_off_days_of_week: number[]
  soft_off_days_of_week: number[]
  hard_off_on_holidays: boolean
  soft_off_on_holidays: boolean
  allow_extra_off_days: boolean
}

interface StaffFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: StaffFormData) => Promise<void>
  initialData?: Partial<StaffProfile> | null
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const defaultForm: StaffFormData = {
  name: '',
  qualification: '正看護師',
  role: '一般',
  work_start_time: '09:00',
  work_end_time: '17:00',
  experience_years: 0,
  max_night_shifts: 8,
  hard_off_days_of_week: [],
  soft_off_days_of_week: [],
  hard_off_on_holidays: false,
  soft_off_on_holidays: false,
  allow_extra_off_days: true,
}

const QUALIFICATION_LABEL: Record<StaffQualification, string> = {
  正看護師: '正看護師',
  准看護師: '准看護師',
}

const ROLE_LABEL: Record<StaffRole, string> = {
  師長: '師長',
  主任: '主任',
  一般: '一般',
}

export function StaffFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
}: StaffFormDialogProps) {
  const [form, setForm] = useState<StaffFormData>(defaultForm)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = !!initialData?.id

  useEffect(() => {
    if (open) {
      setSubmitError(null)
      if (initialData) {
        setForm({
          name: initialData.name ?? '',
          qualification: initialData.qualification ?? '正看護師',
          role: initialData.role ?? '一般',
          work_start_time: initialData.work_start_time ?? '09:00',
          work_end_time: initialData.work_end_time ?? '17:00',
          experience_years: initialData.experience_years ?? 0,
          max_night_shifts: initialData.max_night_shifts ?? 8,
          hard_off_days_of_week: initialData.hard_off_days_of_week ?? [],
          soft_off_days_of_week: initialData.soft_off_days_of_week ?? [],
          hard_off_on_holidays: initialData.hard_off_on_holidays ?? false,
          soft_off_on_holidays: initialData.soft_off_on_holidays ?? false,
          allow_extra_off_days: initialData.allow_extra_off_days ?? true,
        })
      } else {
        setForm(defaultForm)
      }
    }
  }, [open, initialData])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSubmitError(null)
    try {
      await onSubmit(form)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存に失敗しました')
    }
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
                <SelectTrigger>
                  <SelectValue>{QUALIFICATION_LABEL[form.qualification]}</SelectValue>
                </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue>{ROLE_LABEL[form.role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="師長">師長</SelectItem>
                  <SelectItem value="主任">主任</SelectItem>
                  <SelectItem value="一般">一般</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 勤務時間（開始〜終了） */}
          <div className="space-y-1.5">
            <Label>勤務時間</Label>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={form.work_start_time}
                onChange={(e) => setForm({ ...form, work_start_time: e.target.value })}
                className="w-32"
              />
              <span className="text-sm text-gray-500">〜</span>
              <Input
                type="time"
                value={form.work_end_time}
                onChange={(e) => setForm({ ...form, work_end_time: e.target.value })}
                className="w-32"
              />
            </div>
          </div>

          {/* 定休日 */}
          <div className="space-y-2">
            <Label>定休日</Label>
            {/* hard 行 */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">hard</span>
              <div className="flex items-end gap-3">
                <div className="flex gap-2">
                  {DOW_LABELS.map((label, dow) => (
                    <label key={dow} className="flex flex-col items-center gap-1 cursor-pointer">
                      <span className={`text-xs font-medium ${dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>
                        {label}
                      </span>
                      <Checkbox
                        checked={form.hard_off_days_of_week.includes(dow)}
                        onCheckedChange={(checked) =>
                          setForm((prev) => ({
                            ...prev,
                            hard_off_days_of_week: checked
                              ? [...prev.hard_off_days_of_week, dow].sort()
                              : prev.hard_off_days_of_week.filter((d) => d !== dow),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="w-px h-6 bg-gray-200 self-center" />
                <label className="flex flex-col items-center gap-1 cursor-pointer">
                  <span className="text-xs font-medium text-rose-400">祝日</span>
                  <Checkbox
                    checked={form.hard_off_on_holidays}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, hard_off_on_holidays: !!checked }))
                    }
                  />
                </label>
              </div>
            </div>
            {/* soft 行 */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">soft</span>
              <div className="flex items-end gap-3">
                <div className="flex gap-2">
                  {DOW_LABELS.map((label, dow) => (
                    <label key={dow} className="flex flex-col items-center gap-1 cursor-pointer">
                      <span className={`text-xs font-medium ${dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>
                        {label}
                      </span>
                      <Checkbox
                        checked={form.soft_off_days_of_week.includes(dow)}
                        onCheckedChange={(checked) =>
                          setForm((prev) => ({
                            ...prev,
                            soft_off_days_of_week: checked
                              ? [...prev.soft_off_days_of_week, dow].sort()
                              : prev.soft_off_days_of_week.filter((d) => d !== dow),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="w-px h-6 bg-gray-200 self-center" />
                <label className="flex flex-col items-center gap-1 cursor-pointer">
                  <span className="text-xs font-medium text-rose-400">祝日</span>
                  <Checkbox
                    checked={form.soft_off_on_holidays}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, soft_off_on_holidays: !!checked }))
                    }
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Checkbox
              id="allow_extra_off_days"
              checked={form.allow_extra_off_days}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, allow_extra_off_days: !!checked }))
              }
            />
            <div>
              <Label htmlFor="allow_extra_off_days" className="cursor-pointer">
                定休日以外にも休日を入れる
              </Label>
              <p className="text-xs text-gray-400">
                オフにすると定休日・祝日のみ休日になり、目標休日数への追加配分を行いません
              </p>
            </div>
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

          {submitError && (
            <p className="text-sm text-red-500">{submitError}</p>
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
