'use client'

import { LeaveRequest, LeaveType } from '@/types'
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
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequestWithStatus extends LeaveRequest {
  status: LeaveStatus
}

const LEAVE_TYPE_CONFIG: Record<LeaveType, { label: string; className: string }> = {
  希望休: { label: '希望休', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  有給: { label: '有給', className: 'bg-purple-100 text-purple-700 hover:bg-purple-100' },
  特別休暇: { label: '特別休暇', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  シフト希望: { label: 'シフト希望', className: 'bg-teal-100 text-teal-700 hover:bg-teal-100' },
}

const STATUS_CONFIG: Record<LeaveStatus, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100' },
  approved: { label: '承認済み', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  rejected: { label: '却下', className: 'bg-red-100 text-red-600 hover:bg-red-100' },
}

interface LeaveRequestTableProps {
  requests: LeaveRequestWithStatus[]
  onEdit: (req: LeaveRequestWithStatus) => void
  onDelete: (req: LeaveRequestWithStatus) => void
}

export function LeaveRequestTable({ requests, onEdit, onDelete }: LeaveRequestTableProps) {
  return (
    <div className="rounded-xl border border-rose-100 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-rose-50 hover:bg-rose-50">
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4">氏名</TableHead>
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4">日付</TableHead>
            <TableHead className="w-[130px] text-xs font-semibold text-gray-400 px-4">種別</TableHead>
            <TableHead className="text-xs font-semibold text-gray-400 px-4">備考</TableHead>
            <TableHead className="w-[120px] text-xs font-semibold text-gray-400 px-4">ステータス</TableHead>
            <TableHead className="w-[160px] text-xs font-semibold text-gray-400 px-4 text-center">アクション</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-gray-400 py-12">
                申請が登録されていません
              </TableCell>
            </TableRow>
          )}
          {requests.map((req) => {
            const dateLabel = (() => {
              try {
                return format(parseISO(req.date), 'M月d日（E）', { locale: ja })
              } catch {
                return req.date
              }
            })()
            const typeConfig = LEAVE_TYPE_CONFIG[req.type]
            const statusConfig = STATUS_CONFIG[req.status]

            return (
              <TableRow
                key={req.id}
                className="even:bg-gray-50 hover:bg-rose-50/40 transition-colors"
              >
                <TableCell className="px-4 font-medium text-gray-900 text-sm">
                  {req.staff?.name ?? '—'}
                </TableCell>
                <TableCell className="px-4 text-gray-700 text-sm">{dateLabel}</TableCell>
                <TableCell className="px-4">
                  <Badge className={`text-xs font-medium px-2 py-0.5 rounded ${typeConfig.className}`}>
                    {typeConfig.label}
                  </Badge>
                  {req.type === 'シフト希望' && req.preferred_shift_type && (
                    <span className="ml-1.5 text-xs text-gray-500">
                      ({req.preferred_shift_type.name})
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-4 text-gray-600 text-sm">
                  {req.note ?? <span className="text-gray-300">—</span>}
                </TableCell>
                <TableCell className="px-4">
                  <Badge className={`text-xs font-medium px-2 py-0.5 rounded ${statusConfig.className}`}>
                    {statusConfig.label}
                  </Badge>
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onEdit(req)}
                      className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <Pencil className="h-3 w-3" />
                        編集
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(req)}
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
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
