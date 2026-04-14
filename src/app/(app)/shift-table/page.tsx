'use client'

import { useState, useMemo } from 'react'
import { getDaysInMonth, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'
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
  /** AM/PM集計対象 */
  ampm: 'AM' | 'PM' | 'night' | 'off' | null
}

const SHIFT_DEF: Record<Exclude<ShiftCode, ''>, ShiftDef> = {
  早: { code: '早', label: '早番',   bg: 'bg-sky-200',     text: 'text-sky-800',    ampm: 'AM' },
  日: { code: '日', label: '日勤',   bg: 'bg-emerald-200', text: 'text-emerald-800', ampm: null }, // work_hours_typeで分類
  遅: { code: '遅', label: '遅番',   bg: 'bg-orange-200',  text: 'text-orange-800', ampm: 'PM' },
  夜: { code: '夜', label: '夜勤',   bg: 'bg-violet-200',  text: 'text-violet-800', ampm: 'night' },
  明: { code: '明', label: '明け',   bg: 'bg-rose-100',    text: 'text-rose-500',   ampm: 'off' },
  公: { code: '公', label: '公休',   bg: 'bg-gray-100',    text: 'text-gray-500',   ampm: 'off' },
  有: { code: '有', label: '有給',   bg: 'bg-teal-100',    text: 'text-teal-700',   ampm: 'off' },
  他: { code: '他', label: 'その他', bg: 'bg-pink-100',    text: 'text-pink-600',   ampm: 'off' },
}

interface StaffRow {
  staff: StaffProfile
  shifts: ShiftCode[]   // index 0 = 1日
  nightCount: number    // 夜勤回数
  offCount: number      // 休日数
  carryOver: number     // 繰越
}

const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '武石 恵沙美', qualification: '正看護師', role: '師長', work_start_time: '08:30', work_end_time: '17:30', experience_years: 15, max_night_shifts: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '前川 さゆり', qualification: '正看護師', role: '主任', work_start_time: '08:30', work_end_time: '17:30', experience_years: 12, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '広瀬 澪楽',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 8,  max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-4', name: '堀 奈々美',  qualification: '正看護師', role: '一般', work_start_time: '08:30', work_end_time: '17:30', experience_years: 6,  max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-5', name: '伊藤 健二',  qualification: '准看護師', role: '一般', work_start_time: '13:00', work_end_time: '22:00', experience_years: 4,  max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
]

// お風呂の日（モック: 毎週月・木）
const BATH_DAYS_DOW = [1, 4] // 月=1, 木=4

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

function calcNightCount(shifts: ShiftCode[]) {
  return shifts.filter((s) => s === '夜').length
}
function calcOffCount(shifts: ShiftCode[]) {
  return shifts.filter((s) => s === '公' || s === '有').length
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, '0')
  return { value: `2025-${month}`, label: `2025年${i + 1}月` }
})

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function headerBg(dow: number) {
  if (dow === 0) return 'bg-red-50'
  if (dow === 6) return 'bg-blue-50'
  return 'bg-rose-50'
}

function cellBg(dow: number) {
  if (dow === 0) return 'bg-red-50/60'
  if (dow === 6) return 'bg-blue-50/60'
  return ''
}

function dayTextColor(dow: number) {
  if (dow === 0) return 'text-red-500'
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
  const [selectedMonth, setSelectedMonth] = useState('2025-04')

  const { days, rows } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    const days = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      dow: getDay(new Date(year, month - 1, i + 1)),
      isBath: BATH_DAYS_DOW.includes(getDay(new Date(year, month - 1, i + 1))),
    }))
    const rows: StaffRow[] = MOCK_STAFF.map((staff, idx) => {
      const shifts = makeMockShifts(daysInMonth, idx)
      return {
        staff,
        shifts,
        nightCount: calcNightCount(shifts),
        offCount: calcOffCount(shifts),
        carryOver: idx === 0 ? 1 : 0,
      }
    })
    return { days, rows }
  }, [selectedMonth])

  // 日ごとの集計
  const dailyCounts = useMemo(() => {
    return days.map((_, i) => {
      let am = 0, pm = 0, night = 0, off = 0
      rows.forEach(({ staff, shifts }) => {
        const code = shifts[i] ?? ''
        if (!code) { off++; return }
        const def = code ? SHIFT_DEF[code] : null
        if (!def) { off++; return }
        if (def.ampm === 'night') { night++; return }
        if (def.ampm === 'off') { off++; return }
        if (def.ampm === 'AM') { am++; return }
        if (def.ampm === 'PM') { pm++; return }
        // 日勤: work_start_time から AM/PM を導出
        if (code === '日') {
          if (deriveWorkHoursType(staff.work_start_time) === 'AM') am++
          else pm++
        }
      })
      return { am, pm, night, off }
    })
  }, [days, rows])

  return (
    <div className="space-y-4 p-4">
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

      {/* テーブル本体 */}
      <div className="overflow-x-auto rounded-xl border border-rose-100 bg-white">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 'max-content' }}>
          <thead>
            {/* お風呂の日ヘッダー */}
            <tr>
              <th className="sticky left-0 z-20 bg-white border-b border-rose-100 px-2 py-1 text-left text-[10px] text-gray-400 font-normal min-w-[120px]">
                氏名/曜日
              </th>
              {days.map(({ day, dow, isBath }) => (
                <th
                  key={day}
                  className={`px-0 py-1 text-center border-b border-rose-100 w-7 min-w-[28px] ${headerBg(dow)}`}
                >
                  <div className={`text-[10px] font-bold ${isBath ? 'text-cyan-600' : 'text-transparent'}`}>
                    {isBath ? '風' : '　'}
                  </div>
                </th>
              ))}
              {/* 右側集計列ヘッダー */}
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">夜</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">休</th>
              <th className="px-2 py-1 text-center border-b border-l border-rose-100 bg-rose-50 text-gray-500 font-semibold w-8">繰</th>
            </tr>
            {/* 日付・曜日ヘッダー */}
            <tr>
              <th className="sticky left-0 z-20 bg-rose-50 border-b border-rose-100 px-2 py-1" />
              {days.map(({ day, dow }) => (
                <th
                  key={day}
                  className={`px-0 py-1 text-center border-b border-rose-100 ${headerBg(dow)}`}
                >
                  <div className={`font-bold text-[11px] ${dayTextColor(dow)}`}>{day}</div>
                  <div className={`text-[9px] ${dayTextColor(dow)}`}>{DAY_LABELS[dow]}</div>
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
                {/* 氏名（sticky） */}
                <td className={`sticky left-0 z-10 px-2 py-1 border-b border-rose-100 whitespace-nowrap ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                  <span className="font-medium text-gray-800">{staff.name}</span>
                  <span className={`ml-1 text-[10px] font-semibold ${qualBadgeClass(staff)}`}>
                    ({qualLabel(staff)})
                  </span>
                </td>
                {/* シフトセル */}
                {days.map(({ day, dow }, i) => {
                  const code = shifts[i] ?? ''
                  const def = code ? SHIFT_DEF[code] : null
                  return (
                    <td
                      key={day}
                      className={`text-center py-1 px-0 border-b border-gray-100 ${cellBg(dow)}`}
                    >
                      {def ? (
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
                <td className="text-center border-b border-l border-rose-100 text-gray-500 px-1">{carryOver}</td>
              </tr>
            ))}

            {/* 日勤者AM */}
            <tr className="bg-emerald-50">
              <td className="sticky left-0 z-10 bg-emerald-50 px-2 py-1 text-gray-600 font-semibold border-t-2 border-t-emerald-300 border-b border-rose-100 whitespace-nowrap">
                日勤者 AM
              </td>
              {dailyCounts.map((c, i) => (
                <td key={i} className={`text-center py-1 border-t-2 border-t-emerald-300 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow)}`}>
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
                <td key={i} className={`text-center py-1 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow)}`}>
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
                <td key={i} className={`text-center py-1 border-b border-gray-100 font-medium text-gray-700 ${cellBg(days[i].dow)}`}>
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
                <td key={i} className={`text-center py-1 font-medium text-gray-500 ${cellBg(days[i].dow)}`}>
                  {c.off || ''}
                </td>
              ))}
              <td className="border-l border-rose-100" colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* 凡例 */}
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
