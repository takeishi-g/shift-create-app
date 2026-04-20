'use client'

import { useState, useEffect } from 'react'
import { format, addMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Plus, X, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { StaffProfile, ShiftType, StaffPairConstraint, PairConstraintType } from '@/types'
import { PairConstraintDialog, PairConstraintFormData } from '@/components/features/constraints/PairConstraintDialog'
import { createClient } from '@/lib/supabase/client'

interface MinStaffing {
  日勤: number
  夜勤: number
}

interface WorkRules {
  max_consecutive_work_days: number
  min_rest_hours_after_night: number
  auto_insert_off_after_night: boolean
  min_staff_weekend: number
  min_staff_bath_day: number
  target_off_days: number
}

const INITIAL_MIN_STAFFING: MinStaffing = { 日勤: 3, 夜勤: 2 }
const INITIAL_WORK_RULES: WorkRules = {
  max_consecutive_work_days: 5,
  min_rest_hours_after_night: 11,
  auto_insert_off_after_night: true,
  min_staff_weekend: 3,
  min_staff_bath_day: 4,
  target_off_days: 8,
}
const INITIAL_BATH_DAYS = [1, 4]

const PAIR_TYPE_CONFIG: Record<PairConstraintType, { label: string; icon: React.ReactNode; className: string }> = {
  must_pair: {
    label: '必ペア',
    icon: <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />,
    className: 'border-green-200 bg-green-50',
  },
  must_not_pair: {
    label: 'ペア禁止',
    icon: <XCircle className="h-4 w-4 text-red-400 shrink-0" />,
    className: 'border-red-200 bg-red-50',
  },
}

function generateMonths(): string[] {
  const today = new Date()
  return [-1, 0, 1, 2].map((offset) => format(addMonths(today, offset), 'yyyy-MM'))
}

export default function ConstraintsPage() {
  const supabase = createClient()
  const months = generateMonths()
  const [selectedMonth, setSelectedMonth] = useState(months[1])
  const [minStaffing, setMinStaffing] = useState<MinStaffing>(INITIAL_MIN_STAFFING)
  const [workRules, setWorkRules] = useState<WorkRules>(INITIAL_WORK_RULES)
  const [bathDays, setBathDays] = useState<number[]>(INITIAL_BATH_DAYS)
  const [constraintId, setConstraintId] = useState<string | null>(null)
  const [pairs, setPairs] = useState<StaffPairConstraint[]>([])
  const [staffList, setStaffList] = useState<StaffProfile[]>([])
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [pairDialogOpen, setPairDialogOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  // スタッフ・シフト種別・ペア制約は月に関係なく一度だけ取得
  useEffect(() => {
    async function loadMasters() {
      const [{ data: staff }, { data: types }, { data: pairData }] = await Promise.all([
        supabase.from('staff_profiles').select('*').eq('is_active', true).order('created_at'),
        supabase.from('shift_types').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('staff_pair_constraints').select('*').order('created_at'),
      ])
      if (staff) setStaffList(staff)
      if (types) setShiftTypes(types)
      if (pairData) setPairs(pairData)
    }
    loadMasters()
  }, [])

  // 月が変わるたびに制約を読み込む
  useEffect(() => {
    async function loadConstraints() {
      setLoading(true)
      const { data } = await supabase
        .from('shift_constraints')
        .select('*')
        .eq('year_month', selectedMonth)
        .maybeSingle()

      if (data) {
        const minPer = (data.min_staff_per_shift ?? {}) as Record<string, number>
        setMinStaffing({
          日勤: minPer['日勤'] ?? 3,
          夜勤: minPer['夜勤'] ?? 2,
        })
        setWorkRules({
          max_consecutive_work_days: data.max_consecutive_work_days ?? 5,
          min_rest_hours_after_night: data.min_rest_hours_after_night ?? 11,
          auto_insert_off_after_night: data.auto_insert_off_after_night ?? true,
          min_staff_weekend: data.min_staff_weekend ?? 3,
          min_staff_bath_day: data.min_staff_bath_day ?? 4,
          target_off_days: data.target_off_days ?? 8,
        })
        setBathDays(Array.isArray(data.bath_days_of_week) ? data.bath_days_of_week : INITIAL_BATH_DAYS)
        setConstraintId(data.id)
      } else {
        // 未保存の月はデフォルト値にリセット
        setMinStaffing(INITIAL_MIN_STAFFING)
        setWorkRules(INITIAL_WORK_RULES)
        setBathDays(INITIAL_BATH_DAYS)
        setConstraintId(null)
      }
      setLoading(false)
    }
    loadConstraints()
  }, [selectedMonth])

  async function handleSave() {
    const payload = {
      year_month: selectedMonth,
      min_staff_per_shift: { 日勤: minStaffing.日勤, 夜勤: minStaffing.夜勤 },
      min_staff_weekend: workRules.min_staff_weekend,
      min_staff_bath_day: workRules.min_staff_bath_day,
      max_consecutive_work_days: workRules.max_consecutive_work_days,
      min_rest_hours_after_night: workRules.min_rest_hours_after_night,
      auto_insert_off_after_night: workRules.auto_insert_off_after_night,
      target_off_days: workRules.target_off_days,
      bath_days_of_week: bathDays,
      updated_at: new Date().toISOString(),
    }

    if (constraintId) {
      await supabase.from('shift_constraints').update(payload).eq('id', constraintId)
    } else {
      const { data } = await supabase.from('shift_constraints').insert(payload).select().single()
      if (data) setConstraintId(data.id)
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleAddPair(data: PairConstraintFormData) {
    const { data: inserted } = await supabase
      .from('staff_pair_constraints')
      .insert({
        staff_id_a: data.staff_id_a,
        staff_id_b: data.staff_id_b,
        constraint_type: data.constraint_type,
        shift_type_id: data.shift_type_id === 'all' ? null : data.shift_type_id,
        note: null,
      })
      .select()
      .single()
    if (inserted) setPairs((prev) => [...prev, inserted])
    setPairDialogOpen(false)
  }

  async function handleDeletePair(id: string) {
    await supabase.from('staff_pair_constraints').delete().eq('id', id)
    setPairs((prev) => prev.filter((p) => p.id !== id))
  }

  function setMinStaffingField(key: keyof MinStaffing, val: number) {
    setMinStaffing((prev) => ({ ...prev, [key]: val }))
  }

  function setWorkRulesField<K extends keyof WorkRules>(key: K, val: WorkRules[K]) {
    setWorkRules((prev) => ({ ...prev, [key]: val }))
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">勤務制約設定</h1>
        <button
          onClick={handleSave}
          disabled={loading}
          className={`px-5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            saved ? 'bg-green-500 text-white' : 'bg-rose-500 hover:bg-rose-600 text-white'
          } disabled:opacity-50`}
        >
          {saved ? '保存しました' : '保存する'}
        </button>
      </div>

      {/* 月セレクタ */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 shrink-0">対象月:</span>
        <div className="flex gap-1.5">
          {months.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                selectedMonth === m
                  ? 'bg-rose-500 text-white border-rose-500'
                  : 'border-gray-200 text-gray-600 hover:border-rose-300 hover:bg-rose-50'
              }`}
            >
              {format(new Date(m + '-01'), 'yyyy年M月', { locale: ja })}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-gray-400 ml-1">読み込み中...</span>}
      </div>

      {/* 最低配置人数 */}
      <section className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">最低配置人数</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {(Object.keys(minStaffing) as (keyof MinStaffing)[]).map((shift) => (
            <div key={shift} className="flex items-center gap-2">
              <Label className="w-10 text-sm text-gray-600 shrink-0">{shift}</Label>
              <Input
                type="number" min={0} max={20}
                value={minStaffing[shift]}
                onChange={(e) => setMinStaffingField(shift, Number(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-gray-500">人</span>
            </div>
          ))}
        </div>

        {/* 土日・お風呂の日 */}
        <div className="border-t border-gray-100 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div className="flex items-center gap-2">
              <Label className="w-24 text-sm text-gray-600 shrink-0">月間休日数</Label>
              <Input
                type="number" min={0} max={20}
                value={workRules.target_off_days}
                onChange={(e) => setWorkRulesField('target_off_days', Number(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-gray-500">日</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-24 text-sm text-gray-600 shrink-0">土日人数</Label>
              <Input
                type="number" min={0} max={20}
                value={workRules.min_staff_weekend}
                onChange={(e) => setWorkRulesField('min_staff_weekend', Number(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-gray-500">人</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-24 text-sm text-gray-600 shrink-0">お風呂の日人数</Label>
              <Input
                type="number" min={0} max={20}
                value={workRules.min_staff_bath_day}
                onChange={(e) => setWorkRulesField('min_staff_bath_day', Number(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-gray-500">人</span>
            </div>
          </div>
          {/* お風呂の曜日 */}
          <div className="flex items-center gap-4">
            <Label className="w-24 text-sm text-gray-600 shrink-0">お風呂の曜日</Label>
            <div className="flex gap-2">
              {['日', '月', '火', '水', '木', '金', '土'].map((label, dow) => (
                <label key={dow} className="flex flex-col items-center gap-1 cursor-pointer">
                  <span className={`text-xs font-medium ${dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>
                    {label}
                  </span>
                  <Checkbox
                    checked={bathDays.includes(dow)}
                    onCheckedChange={(checked) =>
                      setBathDays((prev) =>
                        checked ? [...prev, dow].sort() : prev.filter((d) => d !== dow)
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 勤怠ルール */}
      <section className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">勤怠ルール</h2>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Label className="w-44 text-sm text-gray-600 shrink-0">連勤最大上限</Label>
            <Input type="number" min={1} max={14} value={workRules.max_consecutive_work_days}
              onChange={(e) => setWorkRulesField('max_consecutive_work_days', Number(e.target.value))}
              className="w-16 text-center" />
            <span className="text-sm text-gray-500">日</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-44 text-sm text-gray-600 shrink-0">夜勤後の休息</Label>
            <Input type="number" min={0} max={24} value={workRules.min_rest_hours_after_night}
              onChange={(e) => setWorkRulesField('min_rest_hours_after_night', Number(e.target.value))}
              className="w-16 text-center" />
            <span className="text-sm text-gray-500">時間</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={workRules.auto_insert_off_after_night}
                onCheckedChange={(v) => setWorkRulesField('auto_insert_off_after_night', !!v)}
              />
              <span className="text-sm text-gray-700">夜勤日に「明け」を自動挿入</span>
            </label>
          </div>
        </div>
      </section>

      {/* ペア制約 */}
      <section className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">ペア制約</h2>
          <button
            onClick={() => setPairDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />追加
          </button>
        </div>
        {pairs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">ペア制約が設定されていません</p>
        ) : (
          <div className="space-y-2">
            {pairs.map((pair) => {
              const config = PAIR_TYPE_CONFIG[pair.constraint_type]
              const staffA = staffList.find((s) => s.id === pair.staff_id_a)?.name ?? pair.staff_id_a
              const staffB = staffList.find((s) => s.id === pair.staff_id_b)?.name ?? pair.staff_id_b
              const shiftLabel = pair.shift_type_id
                ? (shiftTypes.find((st) => st.id === pair.shift_type_id)?.name ?? 'すべて')
                : 'すべて'
              return (
                <div key={pair.id} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${config.className}`}>
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    {config.icon}
                    <span className="font-medium text-gray-500 text-xs">{config.label}:</span>
                    <span>{staffA}</span>
                    <span className="text-gray-400">↔</span>
                    <span>{staffB}</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">
                      {shiftLabel}
                    </span>
                  </div>
                  <button onClick={() => handleDeletePair(pair.id)}
                    className="text-gray-400 hover:text-red-400 transition-colors ml-2">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <PairConstraintDialog
        open={pairDialogOpen}
        onClose={() => setPairDialogOpen(false)}
        onSubmit={handleAddPair}
        staffList={staffList}
        shiftTypes={shiftTypes}
      />
    </div>
  )
}
