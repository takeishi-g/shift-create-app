'use client'

import { StaffProfile } from '@/types'
import { Button } from '@/components/ui/button'
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

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: '正社員',
  part_time: 'パート',
  dispatch: '契約社員',
}

interface StaffWithSkills extends StaffProfile {
  skills: { id: string; name: string }[]
}

interface StaffTableProps {
  staff: StaffWithSkills[]
  onEdit: (staff: StaffWithSkills) => void
  onDelete: (staff: StaffWithSkills) => void
}

export function StaffTable({ staff, onEdit, onDelete }: StaffTableProps) {
  return (
    <div className="rounded-xl border border-rose-100 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-rose-50 hover:bg-rose-50">
            <TableHead className="w-[180px] text-xs font-semibold text-gray-400 px-4">氏名</TableHead>
            <TableHead className="w-[140px] text-xs font-semibold text-gray-400 px-4">雇用形態</TableHead>
            <TableHead className="w-[120px] text-xs font-semibold text-gray-400 px-4">経験年数</TableHead>
            <TableHead className="text-xs font-semibold text-gray-400 px-4">スキル</TableHead>
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4 text-center">アクション</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-gray-400 py-12">
                スタッフが登録されていません
              </TableCell>
            </TableRow>
          )}
          {staff.map((s) => (
            <TableRow
              key={s.id}
              className="even:bg-gray-50 hover:bg-rose-50/40 transition-colors"
            >
              <TableCell className="px-4 font-medium text-gray-900 text-sm">{s.name}</TableCell>
              <TableCell className="px-4 text-gray-700 text-sm">
                {EMPLOYMENT_TYPE_LABEL[s.employment_type] ?? s.employment_type}
              </TableCell>
              <TableCell className="px-4 text-gray-700 text-sm">{s.experience_years}年</TableCell>
              <TableCell className="px-4">
                {s.skills.length === 0 ? (
                  <span className="text-gray-400 text-sm">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {s.skills.map((sk) => (
                      <Badge
                        key={sk.id}
                        className="bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-100 px-2 py-0.5 rounded"
                      >
                        {sk.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="px-4">
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => onEdit(s)}
                    className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <Pencil className="h-3 w-3" />
                      編集
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(s)}
                    className="px-3 py-1 text-xs font-medium text-red-500 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <Trash2 className="h-3 w-3" />
                      削除
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
