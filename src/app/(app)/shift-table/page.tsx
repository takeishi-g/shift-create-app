'use client'

import { useState, useMemo, useEffect } from 'react'
import { getDaysInMonth, getDay, addMonths, startOfMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StaffProfile, deriveWorkHoursType } from '@/types'
import { createClient } from '@/lib/supabase/client'

type ShiftCode = '日' | '夜' | '明' | '公' | '有' | '他' | ''

interface ShiftDef {
  code: ShiftCode
  label: string
  bg: string
  text: string
  ampm: 'AM' | 'PM' | 'night' | 'off' | null
}

const SHIFT_DEF: Record<Exclude<ShiftCode, ''>, ShiftDef> = {
  日: { code: '日', label: '日勤',   bg: '',               text: 'text-gray-700',   ampm: null },
  夜: { code: '夜', label: '夜勤',   bg: 'bg-violet-200',  text: 'text-violet-800', ampm: 'night' },
  明: { code: '明', label: '明け',   bg: 'bg-violet-100',  text: 'text-violet-500', ampm: 'off' },
  公: { code: '公', label: '公休',   bg: 'bg-red-100',     text: 'text-red-500',    ampm: 'off' },
  有: { code: '有', label: '有給',   bg: 'bg-teal-100',    text: 'text-teal-700',   ampm: 'off' },
  他: { code: '他', label: 'その他', bg: 'bg-pink-100',    text: 'text-pink-600',   ampm: 'off' },
}

interface StaffRow {
  staff: StaffProfile
  shifts: ShiftCode[]
  nightCount: number
  offCount: number
  carryOver: number
}

function generateMonths(): { value: string; label: string }[] {
  const now = startOfMonth(new Date())
  return Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(now, i - 3)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    return {
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: `${year}年${month}月`,
    }
  })
}

const MONTHS = generateMonths()
const TODAY_MONTH = MONTHS[3].value

const BATH_DAYS_KEY = 'shift-bath-days-dow'
const DEFAULT_BATH_DAYS_DOW = [1, 4]
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

export default function ShiftTablePage() {
  const supabase = createClient()
  const [selectedMonth, setSelectedMonth] = useState(TODAY_MONTH)
  const [bathDaysDow, setBathDaysDow] = useState<number[]>(DEFAULT_BATH_DAYS_DOW)
  const [staffList, setStaffList] = useState<StaffProfile[]>([])
  const [shiftMap, setShiftMap] = useState<Record<string, ShiftCode>>({})
  const [bathSet, setBathSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStaff() {
      const { data } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('is_active', true)
        .order('created_at')
      if (data) setStaffList(data)
    }
    loadStaff()
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(BATH_DAYS_KEY)
      if (stored) setBathDaysDow(JSON.parse(stored))
    } catch {}
  }, [])

  useEffect(() => {
    async function loadShifts() {
      setLoading(true)
      const { data: scheduleMonth } = await supabase
        .from('schedule_months')
        .select('id')
        .eq('year_month', selectedMonth)
        .single()

      if (!scheduleMonth) {
        setShiftMap({})
        setBathSet(new Set())
        setLoading(false)
        return
      }

      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('staff_id, date, shift_code, is_bath_day')
        .eq('schedule_month_id', scheduleMonth.id)

      if (assignments) {
        const map: Record<string, ShiftCode> = {}
        const baths = new Set<string>()
        assignments.forEach((a) => {
          map[`${a.staff_id}:${a.date}`] = (a.shift_code as ShiftCode) ?? ''
          if (a.is_bath_day) baths.add(a.date)
        })
        setShiftMap(map)
        setBathSet(baths)
      }
      setLoading(false)
    }
    loadShifts()
  }, [selectedMonth])

  const { days, rows } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month - 1, i + 1)
      const dow = getDay(date)
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
      return {
        day: i + 1,
        dow,
        dateStr,
        isBath: bathSet.has(dateStr) || bathDaysDow.includes(dow),
        isHoliday: HolidayJP.isHoliday(date),
      }
    })
    const rows: StaffRow[] = staffList.map((staff, idx) => {
      const shifts = days.map((d) => shiftMap[`${staff.id}:${d.dateStr}`] ?? '')
      return {
        staff,
        shifts,
        nightCount: shifts.filter((s) => s === '夜').length,
        offCount: shifts.filter((s) => s === '公' || s === '有').length,
        carryOver: idx === 0 ? 1 : 0,
      }
    })
    return { days, rows }
  }, [selectedMonth, staffList, shiftMap, bathSet, bathDaysDow])

  const dailyCounts = useMemo(() => {
    return days.map((_, i) => {
      let day = 0, night = 0, off = 0
      rows.forEach(({ shifts }) => {
        const code = shifts[i] ?? ''
        if (!code) { off++; return }
        const def = SHIFT_DEF[code as Exclude<ShiftCode, ''>]
        if (!def) { off++; return }
        if (def.ampm === 'night') { night++; return }
        if (def.ampm === 'off') { off++; return }
        day++
      })
      return { day, night, off }
    })
  }, [days, rows])

  return (
    <div className="space-y-4 p-4">
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
          {loading && <span className="text-xs text-gray-400">読み込み中...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-1.5 text-xs font-semibold text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 transition-colors">
            PDF出力
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-rose-100 bg-white">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white border-b border-rose-100 px-2 py-1 text-left text-[10px] text-gray-400 font-normal w-[120px] min-w-[120px] max-w-[120px]">
                氏名/曜日
              </th>
              {days.map(({ day, dow, isBath, isHoliday }) => (
                <th
                  key={day}
                  className={`px-0 py-1 text-center border-b border-rose-100 w-7 min-w-[28px] ${headerBg(dow, isHoliday)}`}
                >
                  <div className={`text-[10px] font-bold ${isBath ? 'text-cyan-600' : 'text-transparent'}`}>
                    {isBath ? '風' : '　'}
                  </div>
                </th>
              ))}
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">夜</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">休</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">繰</th>
            </tr>
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
            {rows.map(({ staff, shifts, nightCount, offCount, carryOver }, rowIdx) => (
              <tr key={staff.id} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                <td className={`sticky left-0 z-10 px-2 py-1 border-b border-rose-100 whitespace-nowrap ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                  <span className="font-medium text-gray-800">{staff.name}</span>
                  <span className={`ml-1 text-[10px] font-semibold ${qualBadgeClass(staff)}`}>
                    ({qualLabel(staff)})
                  </span>
                </td>
                {days.map(({ day, dow, isHoliday }, i) => {
                  const code = shifts[i] ?? ''
                  const def = code ? SHIFT_DEF[code] : null
                  const nonWorkday = dow === 0 || dow === 6 || isHoliday
                  const showBadge = def && !(code === '日' && !nonWorkday)
                  return (
                    <td
                      key={day}
                      className={`text-center py-1 px-0 border-b border-gray-100 ${cellBg(dow, isHoliday)}`}
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
                <td className="text-center border-b border-l border-rose-100 text-gray-700 font-medium px-1">{nightCount}</td>
                <td className="text-center border-b border-l border-rose-100 text-gray-700 font-medium px-1">{offCount}</td>
                <td className="text-center border-b border-l border-rose-100 text-gray-500 px-1">{carryOver}</td>
              </tr>
            ))}

            <tr className="bg-emerald-50">
              <td className="sticky left-0 z-10 bg-emerald-50 px-2 py-1 text-gray-600 font-semibold border-t-2 border-t-emerald-300 border-b border-rose-100 whitespace-nowrap">
                日勤者
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 border-t-2 border-t-emerald-300 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow, days[i].isHoliday)}`}>
                  {c.day || ''}
                </td>
              ))}
              <td className="border-t-2 border-t-emerald-300 border-l border-rose-100" colSpan={3} />
            </tr>
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

      <div className="flex items-center gap-3 flex-wrap shrink-0 pb-1">
        {Object.values(SHIFT_DEF).map((s) => (
          <div key={s.code} className="flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${s.bg} ${s.text}`}>
              {s.code}
            </span>
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] font-bold text-cyan-600">風</span>
          <span className="text-xs text-gray-500">お風呂の日</span>
        </div>
      </div>
    </div>
  )
}
