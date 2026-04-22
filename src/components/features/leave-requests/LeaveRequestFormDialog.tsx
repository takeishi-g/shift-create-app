'use client'

import { useState, useEffect } from 'react'
import { LeaveRequest, LeaveType, StaffProfile, ShiftType } from '@/types'
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

interface LeaveFormData {
  staff_id: string
  date: string
  type: LeaveType
  preferred_shift_type_id: string | null
  note: string
}

interface LeaveRequestFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: LeaveFormData) => void
  initialData?: LeaveRequest | null
  defaultValues?: { staff_id?: string; date?: string }
  staffList: StaffProfile[]
  shiftTypes: ShiftType[]
}

const defaultForm: LeaveFormData = {
  staff_id: '',
  date: '',
  type: '希望休',
  preferred_shift_type_id: null,
  note: '',
}

export function LeaveRequestFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  defaultValues,
  staffList,
  shiftTypes,
}: LeaveRequestFormDialogProps) {
  const [form, setForm] = useState<LeaveFormData>(defaultForm)
  const isEdit = !!initialData?.id

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          staff_id: initialData.staff_id,
          date: initialData.date,
          type: initialData.type,
          preferred_shift_type_id: initialData.preferred_shift_type_id,
          note: initialData.note ?? '',
        })
      } else {
        setForm({ ...defaultForm, ...(defaultValues ?? {}) })
      }
    }
  }, [open, initialData, defaultValues])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.staff_id || !form.date) return
    onSubmit({
      ...form,
      preferred_shift_type_id: form.type === 'シフト希望' ? form.preferred_shift_type_id : null,
    })
  }

  const nightShiftTypes = shiftTypes.filter((st) => !st.is_off && !['早番', '遅番'].includes(st.name))

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '申請を編集' : '希望休を追加'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* スタッフ */}
          <div className="space-y-1.5">
            <Label>スタッフ <span className="text-red-500">*</span></Label>
            <Select
              value={form.staff_id}
              onValueChange={(v) => v && setForm({ ...form, staff_id: v })}
            >
              <SelectTrigger>
                <span className={form.staff_id ? '' : 'text-gray-400'}>
                  {staffList.find(s => s.id === form.staff_id)?.name ?? 'スタッフを選択'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 日付 */}
          <div className="space-y-1.5">
            <Label htmlFor="date">日付 <span className="text-red-500">*</span></Label>
            <Input
              id="date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>

          {/* 種別 */}
          <div className="space-y-1.5">
            <Label>種別</Label>
            <Select
              value={form.type}
              onValueChange={(v) => v && setForm({ ...form, type: v as LeaveType, preferred_shift_type_id: null })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="希望休">希望休</SelectItem>
                <SelectItem value="有給">有給</SelectItem>
                <SelectItem value="特別休暇">特別休暇</SelectItem>
                <SelectItem value="シフト希望">シフト希望</SelectItem>
                <SelectItem value="他">その他</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* シフト希望の場合のみ: 希望シフト種別 */}
          {form.type === 'シフト希望' && (
            <div className="space-y-1.5">
              <Label>希望シフト</Label>
              <Select
                value={form.preferred_shift_type_id ?? ''}
                onValueChange={(v) => v && setForm({ ...form, preferred_shift_type_id: v })}
              >
                <SelectTrigger>
                  <span className={form.preferred_shift_type_id ? '' : 'text-gray-400'}>
                    {nightShiftTypes.find((st) => st.id === form.preferred_shift_type_id)?.name ?? 'シフトを選択'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {nightShiftTypes.map((st) => (
                    <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 備考 */}
          <div className="space-y-1.5">
            <Label htmlFor="note">備考</Label>
            <Input
              id="note"
              placeholder="任意のメモ"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="submit"
              className="bg-rose-500 hover:bg-rose-600 text-white"
              disabled={!form.staff_id || !form.date}
            >
              {isEdit ? '更新する' : '追加する'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
