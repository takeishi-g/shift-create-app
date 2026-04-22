'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { getDaysInMonth, getDay, addMonths, startOfMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import { Plus } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StaffProfile, ShiftType, LeaveRequest, deriveWorkHoursType } from '@/types'
import { LeaveRequestTable } from '@/components/features/leave-requests/LeaveRequestTable'
import { LeaveRequestFormDialog } from '@/components/features/leave-requests/LeaveRequestFormDialog'
import { DeleteConfirmDialog } from '@/components/features/staff/DeleteConfirmDialog'
import { createClient } from '@/lib/supabase/client'

type ShiftCode = '日' | '夜' | '明' | '公' | '有' | '他' | '希休' | ''

interface ShiftDef {
  code: ShiftCode
  label: string
  bg: string
  text: string
  ampm: 'AM' | 'PM' | 'night' | 'off' | null
}

const SHIFT_DEF: Record<Exclude<ShiftCode, ''>, ShiftDef> = {
  日:  { code: '日',  label: '日勤',   bg: '',               text: 'text-gray-700',   ampm: null },
  夜:  { code: '夜',  label: '夜勤',   bg: 'bg-violet-200',  text: 'text-violet-800', ampm: 'night' },
  明:  { code: '明',  label: '明け',   bg: 'bg-violet-100',  text: 'text-violet-500', ampm: 'off' },
  公:  { code: '公',  label: '公休',   bg: 'bg-red-100',     text: 'text-red-500',    ampm: 'off' },
  有:  { code: '有',  label: '有給',   bg: 'bg-teal-100',    text: 'text-teal-700',   ampm: 'off' },
  他:  { code: '他',  label: 'その他', bg: 'bg-pink-100',    text: 'text-pink-600',   ampm: 'off' },
  希休: { code: '希休', label: '希望休', bg: 'bg-rose-200',   text: 'text-rose-700',   ampm: 'off' },
}

const SHIFT_OPTIONS: Exclude<ShiftCode, ''>[] = ['日', '夜', '明', '公', '有', '他']

function makeDefaultShifts(daysInMonth: number): ShiftCode[] {
  return Array(daysInMonth).fill('日')
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

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const BATH_DAYS_KEY = 'shift-bath-days-dow'
const DEFAULT_BATH_DAYS_DOW = [1, 4]
const sessionKey = (month: string) => `shift-session-${month}`

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
  const supabase = createClient()

  const [selectedMonth, setSelectedMonth] = useState(TODAY_MONTH)
  const [bathDaysDow, setBathDaysDow] = useState<number[]>(DEFAULT_BATH_DAYS_DOW)
  const [shiftGrid, setShiftGrid] = useState<Record<string, ShiftCode[]>>({})
  const [bathSet, setBathSet] = useState<Set<number>>(new Set())
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genWarnings, setGenWarnings] = useState<string[]>([])
  const popoverRef = useRef<HTMLDivElement>(null)

  const [staffList, setStaffList] = useState<StaffProfile[]>([])
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveFormOpen, setLeaveFormOpen] = useState(false)
  const [leaveEditTarget, setLeaveEditTarget] = useState<LeaveRequest | null>(null)
  const [leaveDeleteTarget, setLeaveDeleteTarget] = useState<LeaveRequest | null>(null)
  const [leaveCellPreset, setLeaveCellPreset] = useState<{ staff_id: string; date: string } | undefined>(undefined)

  // マスタデータ読み込み
  useEffect(() => {
    async function loadMasters() {
      const [{ data: staff }, { data: types }] = await Promise.all([
        supabase.from('staff_profiles').select('*').eq('is_active', true).order('created_at'),
        supabase.from('shift_types').select('*').order('display_order'),
      ])
      if (staff) setStaffList(staff)
      if (types) setShiftTypes(types)
    }
    loadMasters()
  }, [])

  // 月変更時に target_off_days を取得（月別→デフォルトの順でフォールバック）
  useEffect(() => {
    async function loadTargetOffDays() {
      const [{ data: monthly }, { data: fallback }] = await Promise.all([
        supabase.from('shift_constraints').select('target_off_days').eq('year_month', selectedMonth).maybeSingle(),
        supabase.from('shift_constraints').select('target_off_days').is('year_month', null).limit(1).maybeSingle(),
      ])
      const val = (monthly?.target_off_days ?? fallback?.target_off_days) as number | null | undefined
      if (val != null) {
        setTargetOffDays(val)
      } else {
        const [y, m] = selectedMonth.split('-').map(Number)
        setTargetOffDays(Math.round(getDaysInMonth(new Date(y, m - 1)) * 0.27))
      }
    }
    loadTargetOffDays()
  }, [selectedMonth])

  // お風呂の曜日をlocalStorageから読み込む
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BATH_DAYS_KEY)
      if (stored) setBathDaysDow(JSON.parse(stored))
    } catch {}
  }, [])

  // 月変更時に希望休を読み込む
  useEffect(() => {
    async function loadLeaveRequests() {
      const [year, month] = selectedMonth.split('-')
      const from = `${year}-${month}-01`
      const lastDay = getDaysInMonth(new Date(Number(year), Number(month) - 1))
      const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`
      const { data } = await supabase
        .from('leave_requests')
        .select('*, staff:staff_profiles(*), preferred_shift_type:shift_types(*)')
        .gte('date', from)
        .lte('date', to)
        .order('date')
      if (data) setLeaveRequests(data)
    }
    loadLeaveRequests()
  }, [selectedMonth])

  const filteredLeaveRequests = useMemo(
    () => leaveRequests.filter((r) => r.date.startsWith(selectedMonth)),
    [leaveRequests, selectedMonth]
  )

  const leaveRequestMap = useMemo(() => {
    const map = new Map<string, LeaveRequest>()
    leaveRequests.forEach(r => map.set(`${r.staff_id}:${r.date}`, r))
    return map
  }, [leaveRequests])

  function leaveTypeToShiftCode(type: LeaveRequest['type']): ShiftCode | null {
    switch (type) {
      case '希望休':   return '希休'
      case '有給':     return '有'
      case '特別休暇': return '他'
      case '他':       return '他'
      default:         return null
    }
  }

  function applyLeaveToGrid(staffId: string, date: string, type: LeaveRequest['type'], isOvernight?: boolean) {
    const [year, month, day] = date.split('-').map(Number)
    const [selYear, selMonth] = selectedMonth.split('-').map(Number)
    if (year !== selYear || month !== selMonth) return
    const dayIdx = day - 1
    if (type === 'シフト希望') {
      if (!isOvernight) return
      setShiftGrid(prev => {
        const row = [...(prev[staffId] ?? [])]
        row[dayIdx] = '夜'
        if (dayIdx + 1 < row.length) row[dayIdx + 1] = '明'
        return { ...prev, [staffId]: row }
      })
      return
    }
    const code = leaveTypeToShiftCode(type)
    if (!code) return
    setShiftGrid(prev => {
      const row = [...(prev[staffId] ?? [])]
      row[dayIdx] = code
      return { ...prev, [staffId]: row }
    })
  }

  async function handleLeaveAdd(data: { staff_id: string; date: string; type: LeaveRequest['type']; preferred_shift_type_id: string | null; note: string }) {
    if (leaveRequestMap.has(`${data.staff_id}:${data.date}`)) return
    const { data: inserted } = await supabase
      .from('leave_requests')
      .insert({ ...data, note: data.note || null })
      .select('*, staff:staff_profiles(*), preferred_shift_type:shift_types(*)')
      .single()
    if (inserted) {
      setLeaveRequests((prev) => [...prev, inserted])
      applyLeaveToGrid(data.staff_id, data.date, data.type, inserted.preferred_shift_type?.is_overnight)
    }
    setLeaveFormOpen(false)
  }

  async function handleLeaveEdit(data: { staff_id: string; date: string; type: LeaveRequest['type']; preferred_shift_type_id: string | null; note: string }) {
    if (!leaveEditTarget) return
    const { data: updated } = await supabase
      .from('leave_requests')
      .update({ ...data, note: data.note || null, updated_at: new Date().toISOString() })
      .eq('id', leaveEditTarget.id)
      .select('*, staff:staff_profiles(*), preferred_shift_type:shift_types(*)')
      .single()
    if (updated) {
      setLeaveRequests((prev) => prev.map((r) => r.id === leaveEditTarget.id ? updated : r))
      applyLeaveToGrid(data.staff_id, data.date, data.type, updated.preferred_shift_type?.is_overnight)
    }
    setLeaveEditTarget(null)
    setLeaveFormOpen(false)
  }

  async function handleLeaveDelete() {
    if (!leaveDeleteTarget) return
    await supabase.from('leave_requests').delete().eq('id', leaveDeleteTarget.id)
    setLeaveRequests((prev) => prev.filter((r) => r.id !== leaveDeleteTarget.id))
    const [year, month, day] = leaveDeleteTarget.date.split('-').map(Number)
    const [selYear, selMonth] = selectedMonth.split('-').map(Number)
    if (year === selYear && month === selMonth) {
      const dayIdx = day - 1
      setShiftGrid(prev => {
        const row = [...(prev[leaveDeleteTarget.staff_id] ?? [])]
        row[dayIdx] = '日'
        return { ...prev, [leaveDeleteTarget.staff_id]: row }
      })
    }
    setLeaveDeleteTarget(null)
  }

  // 日付リスト
  const days = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month - 1, i + 1)
      return { day: i + 1, dow: getDay(date), isHoliday: HolidayJP.isHoliday(date) }
    })
  }, [selectedMonth])

  // 月変更時: localStorage に保存済みセッションがあれば復元、なければ初期化
  useEffect(() => {
    if (staffList.length === 0) return
    const defaultBath = new Set(days.reduce<number[]>((acc, { dow }, i) => {
      if (bathDaysDow.includes(dow)) acc.push(i)
      return acc
    }, []))
    try {
      const saved = localStorage.getItem(sessionKey(selectedMonth))
      if (saved) {
        const { grid: savedGrid, bathSet: savedBath } = JSON.parse(saved) as {
          grid: Record<string, ShiftCode[]>
          bathSet: number[]
        }
        const restored: Record<string, ShiftCode[]> = {}
        staffList.forEach((s) => {
          restored[s.id] = Array.isArray(savedGrid[s.id]) && savedGrid[s.id].length === days.length
            ? savedGrid[s.id]
            : makeDefaultShifts(days.length)
        })
        setShiftGrid(restored)
        setBathSet(Array.isArray(savedBath) ? new Set(savedBath) : defaultBath)
        setEditCell(null)
        setConfirmed(false)
        return
      }
    } catch {}
    // 保存なし: デフォルト初期化
    const newGrid: Record<string, ShiftCode[]> = {}
    staffList.forEach((s) => { newGrid[s.id] = makeDefaultShifts(days.length) })
    setShiftGrid(newGrid)
    setBathSet(defaultBath)
    setEditCell(null)
    setConfirmed(false)
  }, [days, bathDaysDow, staffList])

  // shiftGrid / bathSet の変更を localStorage に保存（空グリッドは除外）
  useEffect(() => {
    if (Object.keys(shiftGrid).length === 0) return
    try {
      localStorage.setItem(sessionKey(selectedMonth), JSON.stringify({
        grid: shiftGrid,
        bathSet: [...bathSet],
      }))
    } catch {}
  }, [shiftGrid, bathSet, selectedMonth])

  // leaveRequests が読み込まれたらグリッドへ反映（リロード・ページ遷移後対応）
  useEffect(() => {
    if (leaveRequests.length === 0) return
    const [selYear, selMonth] = selectedMonth.split('-').map(Number)
    setShiftGrid((prev) => {
      const next: Record<string, ShiftCode[]> = {}
      Object.entries(prev).forEach(([id, shifts]) => { next[id] = [...shifts] })
      leaveRequests.forEach((lr) => {
        const [ly, lm, ld] = lr.date.split('-').map(Number)
        if (ly !== selYear || lm !== selMonth) return
        if (!next[lr.staff_id]) return
        const dayIdx = ld - 1
        if (lr.type === 'シフト希望') {
          if (lr.preferred_shift_type?.is_overnight) {
            next[lr.staff_id][dayIdx] = '夜'
            if (dayIdx + 1 < next[lr.staff_id].length) next[lr.staff_id][dayIdx + 1] = '明'
          }
        } else {
          const code = leaveTypeToShiftCode(lr.type)
          if (code) next[lr.staff_id][dayIdx] = code
        }
      })
      return next
    })
  }, [leaveRequests, selectedMonth])

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

      if (code === '夜' && dayIdx + 1 < row.length) {
        row[dayIdx + 1] = '明'
      }
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

  function handleReset() {
    const newGrid: Record<string, ShiftCode[]> = {}
    staffList.forEach((s) => { newGrid[s.id] = makeDefaultShifts(days.length) })
    setShiftGrid(newGrid)
    setConfirmed(false)
    setGenWarnings([])
    try { localStorage.removeItem(sessionKey(selectedMonth)) } catch {}
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenWarnings([])

    // 前月グリッドを localStorage から取得
    const [selYear, selMonth] = selectedMonth.split('-').map(Number)
    const prevDate = new Date(selYear, selMonth - 2, 1)
    const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    type TailEntry = { staff_id: string; shift_code: string; day: number }
    const prevMonthTail: TailEntry[] = []
    let prevGrid: Record<string, ShiftCode[]> | null = null
    let prevLen = 0
    try {
      const saved = localStorage.getItem(sessionKey(prevMonthKey))
      if (saved) {
        const parsed = JSON.parse(saved) as { grid: Record<string, ShiftCode[]> }
        prevGrid = parsed.grid
        prevLen = Object.values(prevGrid)[0]?.length ?? 0
        if (prevLen > 0) {
          Object.entries(prevGrid).forEach(([staffId, shifts]) => {
            const last = shifts[prevLen - 1]
            const secondLast = shifts[prevLen - 2]
            if (last) prevMonthTail.push({ staff_id: staffId, shift_code: last, day: prevLen })
            if (secondLast) prevMonthTail.push({ staff_id: staffId, shift_code: secondLast, day: prevLen - 1 })
          })
        }
      }
    } catch {}

    const res = await fetch('/api/shift/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year_month: selectedMonth,
        bath_day_indices: [...bathSet],
        prev_month_tail: prevMonthTail.length > 0 ? prevMonthTail : undefined,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setGenWarnings([json.error ?? '生成に失敗しました'])
      setGenerating(false)
      return
    }

    // API側で月跨ぎ処理されなかった場合のクライアント側フォールバック補正
    let resultGrid = json.grid as Record<string, ShiftCode[]>
    if (prevGrid && prevLen > 0) {
      const corrected: Record<string, ShiftCode[]> = {}
      Object.entries(resultGrid).forEach(([id, shifts]) => { corrected[id] = [...shifts] })
      Object.entries(prevGrid).forEach(([staffId, shifts]) => {
        if (!corrected[staffId]) return
        const lastShift = shifts[prevLen - 1]
        if (lastShift === '夜') {
          // 前月末が夜勤 → 当月1日=明け、2日=公休（夜勤でない場合）
          corrected[staffId][0] = '明'
          if (corrected[staffId].length > 1 && corrected[staffId][1] !== '夜') {
            corrected[staffId][1] = '公'
          }
        } else if (lastShift === '明') {
          // 前月末が明け → 当月1日=公休（夜勤・明け以外なら上書き）
          if (corrected[staffId][0] !== '夜' && corrected[staffId][0] !== '明') {
            corrected[staffId][0] = '公'
          }
        }
      })
      resultGrid = corrected
    }

    setShiftGrid(resultGrid)
    if (json.warnings?.length > 0) setGenWarnings(json.warnings)
    if (typeof json.targetOffDays === 'number') setTargetOffDays(json.targetOffDays)
    setConfirmed(false)
    setGenerating(false)
  }

  async function handleConfirm() {
    setSaving(true)
    const [year, month] = selectedMonth.split('-').map(Number)

    const { data: scheduleMonth, error: smError } = await supabase
      .from('schedule_months')
      .upsert(
        { year, month, year_month: selectedMonth, status: 'confirmed', confirmed_at: new Date().toISOString() },
        { onConflict: 'year,month' }
      )
      .select()
      .single()

    if (smError || !scheduleMonth) {
      setGenWarnings([`保存エラー: ${smError?.message ?? 'schedule_months の取得に失敗しました'}`])
      setSaving(false)
      return
    }

    const assignments = staffList.flatMap((staff) =>
      (shiftGrid[staff.id] ?? []).map((code, i) => ({
        schedule_month_id: scheduleMonth.id,
        staff_id: staff.id,
        date: `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
        shift_type_id: null,
        shift_code: code || '日',
        is_bath_day: bathSet.has(i),
      }))
    )

    const { error: saError } = await supabase
      .from('shift_assignments')
      .upsert(assignments, { onConflict: 'schedule_month_id,staff_id,date' })

    if (saError) {
      setGenWarnings([`保存エラー: ${saError.message}`])
      setSaving(false)
      return
    }

    setConfirmed(true)
    setSaving(false)
  }

  const [targetOffDays, setTargetOffDays] = useState<number>(Math.round(30 * 0.27))

  // 日ごとの集計
  const dailyCounts = useMemo(() => {
    return days.map((_, i) => {
      let day = 0, night = 0, off = 0
      staffList.forEach((staff) => {
        const code = shiftGrid[staff.id]?.[i] ?? ''
        if (!code) { off++; return }
        const def = SHIFT_DEF[code as Exclude<ShiftCode, ''>]
        if (!def) { off++; return }
        if (def.ampm === 'night') { night++; return }
        if (def.ampm === 'off') { off++; return }
        day++
      })
      return { day, night, off }
    })
  }, [days, shiftGrid, staffList])

  const currentCode = editCell ? (shiftGrid[editCell.staffId]?.[editCell.dayIdx] ?? '') : ''

  const popoverDate = (() => {
    if (!editCell) return ''
    const [year, month] = selectedMonth.split('-').map(Number)
    const day = editCell.dayIdx + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })()
  const popoverLeave = editCell ? (leaveRequestMap.get(`${editCell.staffId}:${popoverDate}`) ?? null) : null
  const LEAVE_TYPE_LABEL: Record<string, string> = { 希望休: '希望休', 有給: '有給', 特別休暇: '特別休暇', シフト希望: 'シフト希望', 他: 'その他' }

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
          <button
            onClick={handleReset}
            className="px-4 py-1.5 text-xs font-semibold text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            デフォルトに戻す
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-1.5 text-xs font-semibold text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-50"
          >
            {generating ? '生成中...' : 'シフトを自動生成'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
              confirmed
                ? 'bg-green-500 text-white'
                : 'bg-rose-500 hover:bg-rose-600 text-white'
            }`}
          >
            {saving ? '保存中...' : confirmed ? '確定済み' : '確定'}
          </button>
        </div>
      </div>

      {/* 生成警告 */}
      {genWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">⚠️ 以下の制約を完全に満たせませんでした（手動で修正してください）</p>
          {genWarnings.map((w, i) => <p key={i}>・{w}</p>)}
        </div>
      )}

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
            {staffList.map((staff, staffIdx) => {
              const shifts = shiftGrid[staff.id] ?? []
              const nightCount = shifts.filter(s => s === '夜').length
              const offCount = shifts.filter(s => s === '公' || s === '有' || s === '他' || s === '希休').length
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
                          <span className={`inline-flex items-center justify-center h-5 rounded font-bold ${def.code.length > 1 ? 'w-6 text-[8px]' : 'w-5 text-[10px]'} ${def.bg} ${def.text}`}>
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
                  <td className={`text-center border-b border-l border-rose-100 font-medium px-1 ${Math.abs(offCount - targetOffDays) > 1 ? 'bg-red-100 text-red-600' : 'text-gray-700'}`}>{offCount}</td>
                  <td className="text-center border-b border-l border-rose-100 text-gray-500 px-1">{0}</td>
                </tr>
              )
            })}

            {/* 日勤者 */}
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

      {/* 希望休・申請リスト */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-700">希望休・申請一覧</h2>
          <button
            onClick={() => { setLeaveEditTarget(null); setLeaveFormOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            希望休を追加
          </button>
        </div>
        <LeaveRequestTable
          requests={filteredLeaveRequests}
          onEdit={(r) => { setLeaveEditTarget(r); setLeaveFormOpen(true) }}
          onDelete={(r) => setLeaveDeleteTarget(r)}
        />
      </div>

      <LeaveRequestFormDialog
        open={leaveFormOpen}
        onClose={() => { setLeaveFormOpen(false); setLeaveEditTarget(null); setLeaveCellPreset(undefined) }}
        onSubmit={leaveEditTarget ? handleLeaveEdit : handleLeaveAdd}
        initialData={leaveEditTarget}
        defaultValues={leaveCellPreset}
        staffList={staffList}
        shiftTypes={shiftTypes}
      />

      <DeleteConfirmDialog
        open={!!leaveDeleteTarget}
        targetName={leaveDeleteTarget?.staff?.name ? `${leaveDeleteTarget.staff.name}の${leaveDeleteTarget.date}申請` : ''}
        onClose={() => setLeaveDeleteTarget(null)}
        onConfirm={handleLeaveDelete}
      />

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
          {popoverLeave ? (
            <div className="mt-2 border-t border-rose-100 pt-2 space-y-1">
              <p className="text-[10px] text-gray-400">希望休・申請 登録済み</p>
              <div className="text-[11px] text-gray-700 space-y-0.5">
                <div><span className="text-gray-400">種別：</span>{LEAVE_TYPE_LABEL[popoverLeave.type]}</div>
                {popoverLeave.preferred_shift_type && (
                  <div><span className="text-gray-400">希望：</span>{popoverLeave.preferred_shift_type.name}</div>
                )}
                {popoverLeave.note && (
                  <div><span className="text-gray-400">備考：</span>{popoverLeave.note}</div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => { setLeaveEditTarget(popoverLeave); setLeaveFormOpen(true); setEditCell(null) }}
                  className="flex-1 text-[10px] text-rose-500 border border-rose-200 rounded-md py-1 hover:bg-rose-50 transition-colors"
                >
                  編集
                </button>
                <button
                  onClick={() => { setLeaveDeleteTarget(popoverLeave); setEditCell(null) }}
                  className="flex-1 text-[10px] text-red-500 border border-red-200 rounded-md py-1 hover:bg-red-50 transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setLeaveCellPreset({ staff_id: editCell.staffId, date: popoverDate })
                setLeaveEditTarget(null)
                setLeaveFormOpen(true)
                setEditCell(null)
              }}
              className="mt-2 w-full text-[10px] text-rose-500 border border-rose-200 rounded-md py-1 hover:bg-rose-50 transition-colors"
            >
              + 希望休を追加
            </button>
          )}
        </div>
      )}
    </div>
  )
}
