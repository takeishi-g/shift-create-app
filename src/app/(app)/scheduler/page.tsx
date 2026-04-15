'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { getDaysInMonth, getDay } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StaffProfile, deriveWorkHoursType } from '@/types'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------

type ShiftCode = '早' | '日' | '遅' | '夜' | '明' | '公' | '有' | '他' | ''

interface ShiftDef {
  code: ShiftCode
  label: string
  bg: string
  text: string
  ampm: 'AM' | 'PM' | 'night' | 'off' | null
}

const SHIFT_DEF: Record<Exclude<ShiftCode, ''>, ShiftDef> = {
  早: { code: '早', label: '早番',   bg: 'bg-sky-200',     text: 'text-sky-800',    ampm: 'AM' },
  日: { code: '日', label: '日勤',   bg: '',               text: 'text-gray-700',   ampm: null },
  遅: { code: '遅', label: '遅番',   bg: 'bg-orange-200',  text: 'text-orange-800', ampm: 'PM' },
  夜: { code: '夜', label: '夜勤',   bg: 'bg-violet-200',  text: 'text-violet-800', ampm: 'night' },
  明: { code: '明', label: '明け',   bg: 'bg-violet-100',  text: 'text-violet-500', ampm: 'off' },
  公: { code: '公', label: '公休',   bg: 'bg-red-100',     text: 'text-red-500',    ampm: 'off' },
  有: { code: '有', label: '有給',   bg: 'bg-teal-100',    text: 'text-teal-700',   ampm: 'off' },
  他: { code: '他', label: 'その他', bg: 'bg-pink-100',    text: 'text-pink-600',   ampm: 'off' },
}

const SHIFT_OPTIONS: Exclude<ShiftCode, ''>[] = ['早', '日', '遅', '夜', '明', '公', '有', '他']

const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '武石 恵沙美', qualification: '正看護師', role: '師長', work_start_time: '08:30', work_end_time: '17:30', experience_years: 15, max_night_shifts: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '前川 さゆり', qualification: '正看護師', role: '主任', work_start_time: '08:30', work_end_time: '17:30', experience_years: 12, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '広瀬 澪楽',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 8,  max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-4', name: '堀 奈々美',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 6,  max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-5', name: '伊藤 健二',  qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 4,  max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
]

function makeMockShifts(daysInMonth: number, seed: number): ShiftCode[] {
  const patterns: ShiftCode[][] = [
    ['日','日','公','日','日','夜','明','公','日','日','公','日','夜','明','公','日','日','公','公','日','夜','明','公','日','日','公','日','日','公','公','日'],
    ['早','公','日','早','公','早','夜','明','公','早','早','公','早','公','早','早','公','日','夜','明','公','早','公','早','早','公','早','早','公','早','公'],
    ['夜','明','公','夜','明','公','日','夜','明','公','日','夜','明','公','日','夜','明','公','日','夜','明','公','日','公','遅','遅','公','日','日','公','遅'],
    ['公','遅','遅','公','遅','遅','公','遅','公','遅','遅','公','遅','遅','公','公','遅','遅','公','遅','遅','公','遅','公','遅','公','遅','遅','公','遅','遅'],
    ['日','日','日','公','日','日','公','公','早','早','日','日','公','日','日','公','日','早','早','公','日','日','公','早','早','公','日','日','公','日','有'],
  ]
  return patterns[seed % patterns.length].slice(0, daysInMonth)
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, '0')
  return { value: `2025-${month}`, label: `2025年${i + 1}月` }
})

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function headerBg(dow: number, isHoliday: boolean) {
  if (dow === 0 || isHoliday) return 'bg-red-50'
  if (dow === 6) return 'bg-blue-50'
  return 'bg-rose-50'
}

function cellBg(dow: number, isHoliday: boolean) {
  if (dow === 0 || isHoliday) return 'bg-red-50/60'
  if (dow === 6) return 'bg-blue-50/60'
  return ''
}

function dayTextColor(dow: number, isHoliday: boolean) {
  if (dow === 0 || isHoliday) return 'text-red-500'
  if (dow === 6) return 'text-blue-500'
  return 'text-gray-700'
}

function qualLabel(s: StaffProfile) {
  if (s.role === '師長') return '師長'
  if (s.role === '主任') return '主任'
  return s.qualification === '正看護師' ? '看' : '准'
}

function qualBadgeClass(s: StaffProfile) {
  if (s.role === '師長') return 'text-amber-700'
  if (s.role === '主任') return 'text-violet-700'
  return s.qualification === '正看護師' ? 'text-rose-600' : 'text-blue-600'
}

interface EditCell {
  staffId: string
  dayIdx: number
  x: number
  y: number
}

export default function ShiftEditPage() {
  const [selectedMonth, setSelectedMonth] = useState('2025-04')
  const [shiftGrid, setShiftGrid] = useState<Record<string, ShiftCode[]>>({})
  const [bathSet, setBathSet] = useState<Set<number>>(new Set())
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 日付リスト
  const days = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month - 1, i + 1)
      return { day: i + 1, dow: getDay(date), isHoliday: HolidayJP.isHoliday(date) }
    })
  }, [selectedMonth])

  // 月変更時にシフトとお風呂の日をリセット
  useEffect(() => {
    const newGrid: Record<string, ShiftCode[]> = {}
    MOCK_STAFF.forEach((s, idx) => {
      newGrid[s.id] = makeMockShifts(days.length, idx)
    })
    setShiftGrid(newGrid)
    setBathSet(new Set(days.reduce<number[]>((acc, { dow }, i) => {
      if (dow === 1 || dow === 4) acc.push(i)
      return acc
    }, [])))
    setEditCell(null)
    setConfirmed(false)
  }, [days])

  // ポップオーバーの外クリックで閉じる
  useEffect(() => {
    if (!editCell) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditCell(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [editCell])

  function handleCellClick(staffId: string, dayIdx: number, e: React.MouseEvent) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = Math.max(4, Math.min(rect.left - 4, window.innerWidth - 200))
    const y = rect.bottom + 4
    setEditCell({ staffId, dayIdx, x, y })
  }

  function setShift(staffId: string, dayIdx: number, code: ShiftCode) {
    setShiftGrid(prev => {
      const row = [...(prev[staffId] ?? [])]
      const prevCode = row[dayIdx]
      row[dayIdx] = code

      // 「夜」を選択 → 翌日を「明」に自動設定
      if (code === '夜' && dayIdx + 1 < row.length) {
        row[dayIdx + 1] = '明'
      }
      // 「夜」から別のシフトに変更 → 翌日が「明」なら「日」に戻す
      if (prevCode === '夜' && code !== '夜' && dayIdx + 1 < row.length && row[dayIdx + 1] === '明') {
        row[dayIdx + 1] = '日'
      }

      return { ...prev, [staffId]: row }
    })
    setEditCell(null)
  }

  function toggleBathDay(dayIdx: number) {
    setBathSet(prev => {
      const next = new Set(prev)
      if (next.has(dayIdx)) next.delete(dayIdx)
      else next.add(dayIdx)
      return next
    })
  }

  // 日ごとの集計
  const dailyCounts = useMemo(() => {
    return days.map((_, i) => {
      let am = 0, pm = 0, night = 0, off = 0
      MOCK_STAFF.forEach((staff) => {
        const code = shiftGrid[staff.id]?.[i] ?? ''
        if (!code) { off++; return }
        const def = SHIFT_DEF[code]
        if (!def) { off++; return }
        if (def.ampm === 'night') { night++; return }
        if (def.ampm === 'off') { off++; return }
        if (def.ampm === 'AM') { am++; return }
        if (def.ampm === 'PM') { pm++; return }
        if (code === '日') {
          if (deriveWorkHoursType(staff.work_start_time) === 'AM') am++
          else pm++
        }
      })
      return { am, pm, night, off }
    })
  }, [days, shiftGrid])

  const currentCode = editCell ? (shiftGrid[editCell.staffId]?.[editCell.dayIdx] ?? '') : ''

  return (
    <div className="space-y-4 p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">シフト編集</h1>
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
            この内容で作成する
          </button>
          <button
            onClick={() => setConfirmed(true)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              confirmed
                ? 'bg-green-500 text-white'
                : 'bg-rose-500 hover:bg-rose-600 text-white'
            }`}
          >
            {confirmed ? '確定済み' : '確定'}
          </button>
        </div>
      </div>

      {/* テーブル本体 */}
      <div className="overflow-x-auto rounded-xl border border-rose-100 bg-white">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 'max-content' }}>
          <thead>
            {/* お風呂の日ヘッダー（クリックでトグル） */}
            <tr>
              <th className="sticky left-0 z-20 bg-white border-b border-rose-100 px-2 py-1 text-left text-[10px] text-gray-400 font-normal w-[120px] min-w-[120px] max-w-[120px]">
                氏名/曜日
              </th>
              {days.map(({ day, dow, isHoliday }, i) => (
                <th
                  key={day}
                  onClick={() => toggleBathDay(i)}
                  className={`px-0 py-1 text-center border-b border-rose-100 w-7 min-w-[28px] cursor-pointer hover:brightness-95 ${headerBg(dow, isHoliday)}`}
                  title="クリックでお風呂の日を切り替え"
                >
                  <div className={`text-[10px] font-bold ${bathSet.has(i) ? 'text-cyan-600' : 'text-transparent'}`}>
                    {bathSet.has(i) ? '風' : '　'}
                  </div>
                </th>
              ))}
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">夜</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">休</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">繰</th>
            </tr>
            {/* 日付・曜日ヘッダー */}
            <tr>
              <th className="sticky left-0 z-20 bg-rose-50 border-b border-rose-100 px-2 py-1" />
              {days.map(({ day, dow, isHoliday }) => (
                <th
                  key={day}
                  className={`px-0 py-1 text-center border-b border-rose-100 ${headerBg(dow, isHoliday)}`}
                >
                  <div className={`font-bold text-[11px] ${dayTextColor(dow, isHoliday)}`}>{day}</div>
                  <div className={`text-[9px] ${dayTextColor(dow, isHoliday)}`}>{DAY_LABELS[dow]}</div>
                </th>
              ))}
              <th className="border-b border-l border-rose-100 bg-rose-50" />
              <th className="border-b border-l border-rose-100 bg-rose-50" />
              <th className="border-b border-l border-rose-100 bg-rose-50" />
            </tr>
          </thead>
          <tbody>
            {MOCK_STAFF.map((staff, staffIdx) => {
              const shifts = shiftGrid[staff.id] ?? []
              const nightCount = shifts.filter(s => s === '夜').length
              const offCount = shifts.filter(s => s === '公' || s === '有').length
              return (
                <tr key={staff.id} className={staffIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                  {/* 氏名（sticky） */}
                  <td className={`sticky left-0 z-10 px-2 py-1 border-b border-rose-100 whitespace-nowrap ${staffIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                    <span className="font-medium text-gray-800">{staff.name}</span>
                    <span className={`ml-1 text-[10px] font-semibold ${qualBadgeClass(staff)}`}>
                      ({qualLabel(staff)})
                    </span>
                  </td>
                  {/* シフトセル（クリックで編集） */}
                  {days.map(({ day, dow, isHoliday }, i) => {
                    const code = shifts[i] ?? ''
                    const def = code ? SHIFT_DEF[code] : null
                    const nonWorkday = dow === 0 || dow === 6 || isHoliday
                    const showBadge = def && !(code === '日' && !nonWorkday)
                    const isEditing = editCell?.staffId === staff.id && editCell?.dayIdx === i
                    return (
                      <td
                        key={day}
                        onClick={(e) => handleCellClick(staff.id, i, e)}
                        className={`text-center py-1 px-0 border-b border-gray-100 cursor-pointer hover:brightness-95 transition-[filter] ${cellBg(dow, isHoliday)} ${isEditing ? 'outline-2 outline-rose-400 -outline-offset-2' : ''}`}
                      >
                        {showBadge ? (
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${def.bg} ${def.text}`}>
                            {def.code}
                          </span>
                        ) : (
                          <span className="text-gray-200 text-[10px]">—</span>
                        )}
                      </td>
                    )
                  })}
                  {/* 右側集計 */}
                  <td className="text-center border-b border-l border-rose-100 text-gray-700 font-medium px-1">{nightCount}</td>
                  <td className="text-center border-b border-l border-rose-100 text-gray-700 font-medium px-1">{offCount}</td>
                  <td className="text-center border-b border-l border-rose-100 text-gray-500 px-1">{staffIdx === 0 ? 1 : 0}</td>
                </tr>
              )
            })}

            {/* 日勤者AM */}
            <tr className="bg-emerald-50">
              <td className="sticky left-0 z-10 bg-emerald-50 px-2 py-1 text-gray-600 font-semibold border-t-2 border-t-emerald-300 border-b border-rose-100 whitespace-nowrap">
                日勤者 AM
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 border-t-2 border-t-emerald-300 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow, days[i].isHoliday)}`}>
                  {c.am || ''}
                </td>
              ))}
              <td className="border-t-2 border-t-emerald-300 border-l border-rose-100" colSpan={3} />
            </tr>
            {/* 日勤者PM */}
            <tr className="bg-orange-50/60">
              <td className="sticky left-0 z-10 bg-orange-50/60 px-2 py-1 text-gray-600 font-semibold border-b border-rose-100 whitespace-nowrap">
                日勤者 PM
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow, days[i].isHoliday)}`}>
                  {c.pm || ''}
                </td>
              ))}
              <td className="border-b border-l border-rose-100" colSpan={3} />
            </tr>
            {/* 夜勤者 */}
            <tr className="bg-violet-50/60">
              <td className="sticky left-0 z-10 bg-violet-50/60 px-2 py-1 text-gray-600 font-semibold border-b border-rose-100 whitespace-nowrap">
                夜勤者
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow, days[i].isHoliday)}`}>
                  {c.night || ''}
                </td>
              ))}
              <td className="border-b border-l border-rose-100" colSpan={3} />
            </tr>
            {/* 非勤務者 */}
            <tr className="bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-2 py-1 text-gray-500 font-semibold whitespace-nowrap">
                非勤務者
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 font-medium text-gray-500 ${cellBg(days[i].dow, days[i].isHoliday)}`}>
                  {c.off || ''}
                </td>
              ))}
              <td className="border-l border-rose-100" colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 flex-wrap shrink-0 pb-1 text-xs text-gray-500">
        {Object.values(SHIFT_DEF).map((s) => (
          <div key={s.code} className="flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${s.bg} ${s.text}`}>
              {s.code}
            </span>
            <span>{s.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] font-bold text-cyan-600">風</span>
          <span>お風呂の日（上段クリックで切り替え）</span>
        </div>
      </div>

      {/* シフト編集ポップオーバー */}
      {editCell && (
        <div
          ref={popoverRef}
          className="fixed z-50 bg-white rounded-xl border border-gray-200 shadow-xl p-2.5"
          style={{ top: editCell.y, left: editCell.x }}
        >
          <p className="text-[10px] text-gray-400 mb-1.5 px-0.5">シフトを選択</p>
          <div className="grid grid-cols-4 gap-1">
            {SHIFT_OPTIONS.map(code => {
              const def = SHIFT_DEF[code]
              return (
                <button
                  key={code}
                  onClick={() => setShift(editCell.staffId, editCell.dayIdx, code)}
                  className={`w-8 h-8 rounded text-[11px] font-bold transition-transform hover:scale-110 ${
                    currentCode === code ? 'ring-2 ring-rose-400' : ''
                  } ${def.bg || 'bg-gray-100'} ${def.text}`}
                >
                  {code}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
