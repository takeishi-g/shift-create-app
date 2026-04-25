'use client'

import { StaffProfile, deriveWorkHoursType } from '@/types'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2 } from 'lucide-react'

const QUALIFICATION_STYLE: Record<string, string> = {
  正看護師: 'bg-rose-100 text-rose-700',
  准看護師: 'bg-blue-100 text-blue-700',
}

const ROLE_STYLE: Record<string, string> = {
  師長: 'bg-amber-100 text-amber-700',
  主任: 'bg-violet-100 text-violet-700',
  一般: 'bg-gray-100 text-gray-500',
}

const OFF_CONSTRAINT_STYLE: Record<StaffProfile['off_days_constraint'], string> = {
  hard: 'bg-rose-100 text-rose-700',
  soft: 'bg-amber-100 text-amber-700',
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

interface StaffTableProps {
  staff: StaffProfile[]
  onEdit: (staff: StaffProfile) => void
  onDelete: (staff: StaffProfile) => void
}

export function StaffTable({ staff, onEdit, onDelete }: StaffTableProps) {
  return (
    <div className="rounded-xl border border-rose-100 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-rose-50 hover:bg-rose-50">
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4">氏名</TableHead>
            <TableHead className="w-[110px] text-xs font-semibold text-gray-400 px-4">資格</TableHead>
            <TableHead className="w-[90px] text-xs font-semibold text-gray-400 px-4">役職</TableHead>
            <TableHead className="w-[140px] text-xs font-semibold text-gray-400 px-4">勤務時間</TableHead>
            <TableHead className="w-[100px] text-xs font-semibold text-gray-400 px-4">夜勤上限</TableHead>
            <TableHead className="w-[180px] text-xs font-semibold text-gray-400 px-4">定休日</TableHead>
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4 text-center">アクション</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-gray-400 py-12">
                スタッフが登録されていません
              </TableCell>
            </TableRow>
          )}
          {staff.map((s) => (
            <TableRow key={s.id} className="even:bg-gray-50 hover:bg-rose-50/40 transition-colors">
              <TableCell className="px-4 font-medium text-gray-900 text-sm">{s.name}</TableCell>
              <TableCell className="px-4">
                <Badge className={`text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 ${QUALIFICATION_STYLE[s.qualification]}`}>
                  {s.qualification === '正看護師' ? '正看' : '准看'}
                </Badge>
              </TableCell>
              <TableCell className="px-4">
                {s.role !== '一般' ? (
                  <Badge className={`text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 ${ROLE_STYLE[s.role]}`}>
                    {s.role}
                  </Badge>
                ) : (
                  <span className="text-gray-400 text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="px-4 text-gray-700 text-sm">
                {s.work_start_time} 〜 {s.work_end_time}
                <span className="ml-1.5 text-xs text-gray-400">({deriveWorkHoursType(s.work_start_time)})</span>
              </TableCell>
              <TableCell className="px-4 text-gray-700 text-sm">{s.max_night_shifts}回</TableCell>
              <TableCell className="px-4">
                {s.off_days_of_week.length > 0 || s.off_on_holidays ? (
                  <div className="flex flex-wrap gap-1.5">
                    {s.off_days_of_week.map((day) => (
                      <Badge
                        key={`${s.id}-off-${day}`}
                        className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-slate-100 text-slate-700"
                      >
                        {DAY_LABELS[day]}
                      </Badge>
                    ))}
                    {s.off_on_holidays && (
                      <Badge className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-blue-100 text-blue-700">
                        祝
                      </Badge>
                    )}
                    <Badge
                      className={`text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 ${OFF_CONSTRAINT_STYLE[s.off_days_constraint]}`}
                    >
                      {s.off_days_constraint === 'hard' ? 'ハード' : 'ソフト'}
                    </Badge>
                  </div>
                ) : (
                  <span className="text-gray-400 text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="px-4">
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => onEdit(s)}
                    className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <Pencil className="h-3 w-3" />編集
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(s)}
                    className="px-3 py-1 text-xs font-medium text-red-500 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <Trash2 className="h-3 w-3" />削除
                    </span>
                  </button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
