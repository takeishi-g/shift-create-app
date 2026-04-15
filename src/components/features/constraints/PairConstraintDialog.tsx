'use client'

import { useState, useEffect } from 'react'
import { StaffProfile, PairConstraintType } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type PairShiftType = '日勤' | '夜勤' | 'all'

export interface PairConstraintFormData {
  staff_id_a: string
  staff_id_b: string
  constraint_type: PairConstraintType
  shift_type: PairShiftType
}

interface PairConstraintDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: PairConstraintFormData) => void
  staffList: StaffProfile[]
}

const defaultForm: PairConstraintFormData = {
  staff_id_a: '',
  staff_id_b: '',
  constraint_type: 'must_pair',
  shift_type: 'all',
}

export function PairConstraintDialog({
  open,
  onClose,
  onSubmit,
  staffList,
}: PairConstraintDialogProps) {
  const [form, setForm] = useState<PairConstraintFormData>(defaultForm)

  useEffect(() => {
    if (open) setForm(defaultForm)
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.staff_id_a || !form.staff_id_b || form.staff_id_a === form.staff_id_b) return
    onSubmit(form)
  }

  const isValid = form.staff_id_a && form.staff_id_b && form.staff_id_a !== form.staff_id_b

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>ペア制約を追加</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* 制約タイプ */}
          <div className="space-y-1.5">
            <Label>制約タイプ</Label>
            <Select
              value={form.constraint_type}
              onValueChange={(v) => v && setForm({ ...form, constraint_type: v as PairConstraintType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="must_pair">必ペア（同じシフトに入れる）</SelectItem>
                <SelectItem value="must_not_pair">ペア禁止（同じシフトに入れない）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 対象シフト */}
          <div className="space-y-1.5">
            <Label>対象シフト</Label>
            <Select
              value={form.shift_type}
              onValueChange={(v) => v && setForm({ ...form, shift_type: v as PairShiftType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="日勤">日勤</SelectItem>
                <SelectItem value="夜勤">夜勤</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* スタッフ A */}
          <div className="space-y-1.5">
            <Label>スタッフ A <span className="text-red-500">*</span></Label>
            <Select
              value={form.staff_id_a}
              onValueChange={(v) => v && setForm({ ...form, staff_id_a: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* スタッフ B */}
          <div className="space-y-1.5">
            <Label>スタッフ B <span className="text-red-500">*</span></Label>
            <Select
              value={form.staff_id_b}
              onValueChange={(v) => v && setForm({ ...form, staff_id_b: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {staffList
                  .filter((s) => s.id !== form.staff_id_a)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {form.staff_id_a && form.staff_id_b && form.staff_id_a === form.staff_id_b && (
            <p className="text-xs text-red-500">同じスタッフは選択できません</p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="submit"
              className="bg-rose-500 hover:bg-rose-600 text-white"
              disabled={!isValid}
            >
              追加する
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
