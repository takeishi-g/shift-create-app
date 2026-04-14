'use client'

import { useState } from 'react'
import { Plus, X, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { StaffProfile, StaffPairConstraint, PairConstraintType } from '@/types'
import { PairConstraintDialog, PairConstraintFormData } from '@/components/features/constraints/PairConstraintDialog'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------
const MOCK_STAFF: StaffProfile[] = [
  { id: 'st-1', name: '山田 太郎', employment_type: 'full_time', experience_years: 5, max_hours_per_month: 160, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-2', name: '鈴木 花子', employment_type: 'part_time', experience_years: 2, max_hours_per_month: 100, max_night_shifts: 4, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-3', name: '田中 一郎', employment_type: 'full_time', experience_years: 8, max_hours_per_month: 160, max_night_shifts: 8, is_active: true, created_at: '', updated_at: '' },
  { id: 'st-4', name: '佐藤 美咲', employment_type: 'dispatch', experience_years: 3, max_hours_per_month: 120, max_night_shifts: 6, is_active: true, created_at: '', updated_at: '' },
]

interface MinStaffing {
  早番: number
  日勤: number
  遅番: number
  夜勤: number
}

interface WorkRules {
  max_consecutive_work_days: number
  min_rest_hours_after_night: number
  auto_insert_off_after_night: boolean
  max_night_shifts_per_month: number
}

const INITIAL_MIN_STAFFING: MinStaffing = {
  早番: 2,
  日勤: 3,
  遅番: 2,
  夜勤: 2,
}

const INITIAL_WORK_RULES: WorkRules = {
  max_consecutive_work_days: 5,
  min_rest_hours_after_night: 11,
  auto_insert_off_after_night: true,
  max_night_shifts_per_month: 4,
}

const INITIAL_PAIRS: StaffPairConstraint[] = [
  { id: 'pc-1', staff_id_a: 'st-1', staff_id_b: 'st-2', constraint_type: 'must_pair', shift_type_id: null, note: '追加のみ', created_at: '' },
  { id: 'pc-2', staff_id_a: 'st-3', staff_id_b: 'st-4', constraint_type: 'must_not_pair', shift_type_id: null, note: '全シフト', created_at: '' },
]

let nextPairId = 100

function staffName(id: string) {
  return MOCK_STAFF.find((s) => s.id === id)?.name ?? id
}

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

export default function ConstraintsPage() {
  const [minStaffing, setMinStaffing] = useState<MinStaffing>(INITIAL_MIN_STAFFING)
  const [workRules, setWorkRules] = useState<WorkRules>(INITIAL_WORK_RULES)
  const [pairs, setPairs] = useState<StaffPairConstraint[]>(INITIAL_PAIRS)
  const [pairDialogOpen, setPairDialogOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    // TODO: Supabase に保存
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleAddPair(data: PairConstraintFormData) {
    const newPair: StaffPairConstraint = {
      id: `pc-${nextPairId++}`,
      staff_id_a: data.staff_id_a,
      staff_id_b: data.staff_id_b,
      constraint_type: data.constraint_type,
      shift_type_id: null,
      note: null,
      created_at: new Date().toISOString(),
    }
    setPairs((prev) => [...prev, newPair])
    setPairDialogOpen(false)
  }

  function handleDeletePair(id: string) {
    setPairs((prev) => prev.filter((p) => p.id !== id))
  }

  function setMinStaffingField(key: keyof MinStaffing, val: number) {
    setMinStaffing((prev) => ({ ...prev, [key]: val }))
  }

  function setWorkRulesField<K extends keyof WorkRules>(key: K, val: WorkRules[K]) {
    setWorkRules((prev) => ({ ...prev, [key]: val }))
  }

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">勤務制約設定</h1>
        <button
          onClick={handleSave}
          className={`px-5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-rose-500 hover:bg-rose-600 text-white'
          }`}
        >
          {saved ? '保存しました' : '保存する'}
        </button>
      </div>

      {/* 最低配置人数 */}
      <section className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">最低配置人数</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {(Object.keys(minStaffing) as (keyof MinStaffing)[]).map((shift) => (
            <div key={shift} className="flex items-center gap-2">
              <Label className="w-10 text-sm text-gray-600 shrink-0">{shift}</Label>
              <Input
                type="number"
                min={0}
                max={20}
                value={minStaffing[shift]}
                onChange={(e) => setMinStaffingField(shift, Number(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-gray-500">人</span>
            </div>
          ))}
        </div>
      </section>

      {/* 勤怠ルール */}
      <section className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">勤怠ルール</h2>
        <div className="space-y-4">
          {/* 連勤最大上限 */}
          <div className="flex items-center gap-3">
            <Label className="w-44 text-sm text-gray-600 shrink-0">連勤最大上限</Label>
            <Input
              type="number"
              min={1}
              max={14}
              value={workRules.max_consecutive_work_days}
              onChange={(e) => setWorkRulesField('max_consecutive_work_days', Number(e.target.value))}
              className="w-16 text-center"
            />
            <span className="text-sm text-gray-500">日</span>
          </div>

          {/* 夜勤後の休息 */}
          <div className="flex items-center gap-3">
            <Label className="w-44 text-sm text-gray-600 shrink-0">夜勤後の休息</Label>
            <Input
              type="number"
              min={0}
              max={24}
              value={workRules.min_rest_hours_after_night}
              onChange={(e) => setWorkRulesField('min_rest_hours_after_night', Number(e.target.value))}
              className="w-16 text-center"
            />
            <span className="text-sm text-gray-500">時間</span>
          </div>

          {/* 夜勤日に「明け」を自動挿入 */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={workRules.auto_insert_off_after_night}
                onCheckedChange={(v) => setWorkRulesField('auto_insert_off_after_night', !!v)}
              />
              <span className="text-sm text-gray-700">夜勤日に「明け」を自動挿入</span>
            </label>
          </div>

          {/* 月間最大夜勤回数 */}
          <div className="flex items-center gap-3">
            <Label className="w-44 text-sm text-gray-600 shrink-0">月間最大夜勤回数</Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={workRules.max_night_shifts_per_month}
              onChange={(e) => setWorkRulesField('max_night_shifts_per_month', Number(e.target.value))}
              className="w-16 text-center"
            />
            <span className="text-sm text-gray-500">回</span>
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
            <Plus className="h-3.5 w-3.5" />
            追加
          </button>
        </div>

        {pairs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">ペア制約が設定されていません</p>
        ) : (
          <div className="space-y-2">
            {pairs.map((pair) => {
              const config = PAIR_TYPE_CONFIG[pair.constraint_type]
              return (
                <div
                  key={pair.id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${config.className}`}
                >
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    {config.icon}
                    <span className="font-medium text-gray-500 text-xs">{config.label}:</span>
                    <span>{staffName(pair.staff_id_a)}</span>
                    <span className="text-gray-400">↔</span>
                    <span>{staffName(pair.staff_id_b)}</span>
                    {pair.note && (
                      <span className="text-xs text-gray-400">（{pair.note}）</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeletePair(pair.id)}
                    className="text-gray-400 hover:text-red-400 transition-colors ml-2"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ペア制約追加ダイアログ */}
      <PairConstraintDialog
        open={pairDialogOpen}
        onClose={() => setPairDialogOpen(false)}
        onSubmit={handleAddPair}
        staffList={MOCK_STAFF}
      />
    </div>
  )
}
