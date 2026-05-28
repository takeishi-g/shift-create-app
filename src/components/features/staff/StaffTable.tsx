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
import { Pencil, Trash2, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const QUALIFICATION_STYLE: Record<string, string> = {
  正看護師: 'bg-rose-100 text-rose-700',
  准看護師: 'bg-blue-100 text-blue-700',
}

const ROLE_STYLE: Record<string, string> = {
  師長: 'bg-amber-100 text-amber-700',
  主任: 'bg-violet-100 text-violet-700',
  一般: 'bg-gray-100 text-gray-500',
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

interface StaffRowProps {
  s: StaffProfile
  onEdit: (staff: StaffProfile) => void
  onDelete: (staff: StaffProfile) => void
}

function SortableStaffRow({ s, onEdit, onDelete }: StaffRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className="even:bg-gray-50 hover:bg-rose-50/40 transition-colors"
    >
      <TableCell className="px-2 w-8">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors touch-none"
          aria-label="並び替え"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
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
        {(s.hard_off_days_of_week ?? []).length > 0 || (s.soft_off_days_of_week ?? []).length > 0 || s.hard_off_on_holidays || s.soft_off_on_holidays ? (
          <div className="flex flex-wrap gap-1.5">
            {(s.hard_off_days_of_week ?? []).map((day) => (
              <Badge
                key={`${s.id}-hard-${day}`}
                className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-rose-100 text-rose-700"
              >
                {DAY_LABELS[day]}
              </Badge>
            ))}
            {s.hard_off_on_holidays && (
              <Badge className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-rose-100 text-rose-700">
                祝
              </Badge>
            )}
            {(s.soft_off_days_of_week ?? []).map((day) => (
              <Badge
                key={`${s.id}-soft-${day}`}
                className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-amber-100 text-amber-700"
              >
                {DAY_LABELS[day]}
              </Badge>
            ))}
            {s.soft_off_on_holidays && (
              <Badge className="text-xs font-medium px-2 py-0.5 rounded hover:opacity-100 bg-amber-100 text-amber-700">
                祝
              </Badge>
            )}
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
  )
}

interface StaffTableProps {
  staff: StaffProfile[]
  onEdit: (staff: StaffProfile) => void
  onDelete: (staff: StaffProfile) => void
  onReorder: (activeId: string, overId: string) => void
}

export function StaffTable({ staff, onEdit, onDelete, onReorder }: StaffTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id))
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="rounded-xl border border-rose-100 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-rose-50 hover:bg-rose-50">
              <TableHead className="w-8 px-2" />
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
                <TableCell colSpan={8} className="text-center text-sm text-gray-400 py-12">
                  スタッフが登録されていません
                </TableCell>
              </TableRow>
            )}
            <SortableContext items={staff.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {staff.map((s) => (
                <SortableStaffRow key={s.id} s={s} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </SortableContext>
          </TableBody>
        </Table>
      </div>
    </DndContext>
  )
}
