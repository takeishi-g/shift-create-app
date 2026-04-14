'use client'

import { useState, useMemo } from 'react'
import { getDaysInMonth, format, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------

type ShiftCode = '早' | '日' | '遅' | '夜' | '明' | '公' | '有' | ''

interface ShiftCell {
  code: ShiftCode
  label: string
  bg: string
  text: string
}

const SHIFT_MAP: Record<Exclude<ShiftCode, ''>, ShiftCell> = {
  早: { code: '早', label: '早番', bg: 'bg-sky-100',    text: 'text-sky-700' },
  日: { code: '日', label: '日勤', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  遅: { code: '遅', label: '遅番', bg: 'bg-orange-100', text: 'text-orange-700' },
  夜: { code: '夜', label: '夜勤', bg: 'bg-violet-100', text: 'text-violet-700' },
  明: { code: '明', label: '明け', bg: 'bg-rose-100',   text: 'text-rose-500' },
  公: { code: '公', label: '公休', bg: 'bg-gray-100',   text: 'text-gray-500' },
  有: { code: '有', label: '有給', bg: 'bg-teal-100',   text: 'text-teal-700' },
}

interface StaffRow {
  id: string
  name: string
  shifts: ShiftCode[] // index 0 = day 1
}

const MOCK_STAFF_SHIFTS: StaffRow[] = [
  {
    id: 'st-1', name: '山田 太郎',
    shifts: ['日','日','公','日','日','公','公','日','夜','明','公','日','日','公','公','日','日','遅','日','公','公','日','夜','明','公','日','日','公','公','日','日'],
  },
  {
    id: 'st-2', name: '鈴木 花子',
    shifts: ['早','公','日','早','公','早','早','公','日','日','早','公','早','早','公','早','公','日','早','早','公','早','公','日','早','早','公','早','早','公','早'],
  },
  {
    id: 'st-3', name: '田中 一郎',
    shifts: ['夜','明','公','夜','明','公','日','夜','明','公','日','夜','明','公','日','夜','明','公','日','夜','明','公','日','日','公','遅','遅','公','日','日','公'],
  },
  {
    id: 'st-4', name: '佐藤 美咲',
    shifts: ['公','遅','遅','公','遅','遅','公','遅','公','遅','遅','公','遅','遅','公','公','遅','遅','公','遅','遅','公','遅','公','遅','公','遅','遅','公','遅','遅'],
  },
  {
    id: 'st-5', name: '伊藤 健二',
    shifts: ['日','日','日','公','日','日','公','公','早','早','日','日','公','日','日','公','日','早','早','公','日','日','公','早','早','公','日','日','公','日','有'],
  },
]

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, '0')
  return { value: `2025-${month}`, label: `2025年${i + 1}月` }
})

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function getDayColor(dayOfWeek: number) {
  if (dayOfWeek === 0) return 'text-red-500'
  if (dayOfWeek === 6) return 'text-blue-500'
  return 'text-gray-500'
}

function getCellBgByDayOfWeek(dayOfWeek: number) {
  if (dayOfWeek === 0) return 'bg-red-50'
  if (dayOfWeek === 6) return 'bg-blue-50'
  return ''
}

export default function ShiftTablePage() {
  const [selectedMonth, setSelectedMonth] = useState('2025-04')

  const { days, staffRows } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month - 1, i + 1)
      return { day: i + 1, dow: getDay(date) }
    })

    // モックデータを月の日数に合わせてトリム/パッド
    const staffRows = MOCK_STAFF_SHIFTS.map((s) => ({
      ...s,
      shifts: s.shifts.slice(0, daysInMonth),
    }))

    return { days, staffRows }
  }, [selectedMonth])

  // 日ごとの配置数（公休・有給以外）
  const staffingCounts = useMemo(() => {
    return days.map((_, i) =>
      staffRows.filter((s) => {
        const code = s.shifts[i]
        return code && code !== '公' && code !== '有' && code !== '明'
      }).length
    )
  }, [days, staffRows])

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">シフト表</h1>
          <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
            <SelectTrigger className="w-[150px] bg-white border-gray-200 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-1.5 text-xs font-semibold text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 transition-colors">
            PDF出力
          </button>
          <button className="px-4 py-1.5 text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors">
            確定
          </button>
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto rounded-xl border border-rose-100 bg-white">
        <table className="border-collapse text-xs" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr className="bg-rose-50">
              {/* 氏名列ヘッダー */}
              <th className="sticky left-0 z-20 bg-rose-50 px-3 py-2 text-left text-gray-400 font-semibold border-b border-r border-rose-100 min-w-[100px]">
                氏名
              </th>
              {/* 日付ヘッダー */}
              {days.map(({ day, dow }) => (
                <th
                  key={day}
                  className={`px-0 py-1.5 text-center font-semibold border-b border-rose-100 w-8 min-w-[32px] ${getCellBgByDayOfWeek(dow)}`}
                >
                  <div className="text-gray-700">{day}</div>
                  <div className={`text-[10px] ${getDayColor(dow)}`}>{DAY_LABELS[dow]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staffRows.map((row, rowIdx) => (
              <tr
                key={row.id}
                className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                {/* 氏名（sticky） */}
                <td className={`sticky left-0 z-10 px-3 py-1.5 font-medium text-gray-800 border-r border-rose-100 whitespace-nowrap ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  {row.name}
                </td>
                {/* シフトセル */}
                {days.map(({ day, dow }, i) => {
                  const code = row.shifts[i] ?? ''
                  const cell = code ? SHIFT_MAP[code] : null
                  return (
                    <td
                      key={day}
                      className={`text-center py-1.5 px-0.5 border-b border-gray-100 ${getCellBgByDayOfWeek(dow)}`}
                    >
                      {cell ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold ${cell.bg} ${cell.text}`}>
                          {cell.code}
                        </span>
                      ) : (
                        <span className="text-gray-200">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* 配置数の行 */}
            <tr className="bg-emerald-50 font-semibold">
              <td className="sticky left-0 z-10 bg-emerald-50 px-3 py-1.5 text-gray-600 border-r border-r-rose-100 border-t border-t-emerald-200">
                配置数
              </td>
              {staffingCounts.map((count, i) => (
                <td
                  key={i}
                  className={`text-center py-1.5 border-t border-emerald-200 text-gray-700 ${getCellBgByDayOfWeek(days[i].dow)}`}
                >
                  {count}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 flex-wrap shrink-0 pb-1">
        {Object.values(SHIFT_MAP).map((s) => (
          <div key={s.code} className="flex items-center gap-1.5">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${s.bg} ${s.text}`}>
              {s.code}
            </span>
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
