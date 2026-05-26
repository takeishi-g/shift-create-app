'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ConstraintData {
  minDay: number
  maxDay: number | null
  minNight: number
  minWeekend: number
  minBathDay: number
  targetOffDays: number
}

interface Props {
  yearMonth: string
}

/** 制約条件の配置人数をコンパクトに表示するサマリーバー */
export function ConstraintSummary({ yearMonth }: Props) {
  const supabase = createClient()
  const [data, setData] = useState<ConstraintData | null>(null)

  useEffect(() => {
    async function load() {
      // 月別設定 → デフォルト設定の順でフォールバック
      const [{ data: monthly }, { data: fallback }] = await Promise.all([
        supabase.from('shift_constraints').select('*').eq('year_month', yearMonth).maybeSingle(),
        supabase.from('shift_constraints').select('*').is('year_month', null).limit(1).maybeSingle(),
      ])

      const src = monthly ?? fallback
      if (!src) {
        // どちらも未設定の場合はデフォルト値を表示
        setData({ minDay: 3, maxDay: null, minNight: 2, minWeekend: 3, minBathDay: 4, targetOffDays: 8 })
        return
      }

      const minPer = (src.min_staff_per_shift ?? {}) as Record<string, number>
      const maxPer = (src.max_staff_per_shift ?? {}) as Record<string, number | null>
      const rawMaxDay = maxPer['日勤']
      setData({
        minDay: minPer['日勤'] ?? 3,
        maxDay: typeof rawMaxDay === 'number' ? rawMaxDay : null,
        minNight: minPer['夜勤'] ?? 2,
        minWeekend: src.min_staff_weekend ?? 3,
        minBathDay: src.min_staff_bath_day ?? 4,
        targetOffDays: src.target_off_days ?? 8,
      })
    }
    load()
  }, [yearMonth])

  if (!data) return null

  const items: { label: string; value: string; hint: string }[] = [
    { label: '日勤', value: data.maxDay != null ? `${data.minDay}〜${data.maxDay}人` : `${data.minDay}人〜`, hint: '配置人数範囲' },
    { label: '夜勤', value: `${data.minNight}人`, hint: '最低配置' },
    { label: '土日祝最低', value: `${data.minWeekend}人`, hint: '最低配置' },
    { label: '風呂', value: `${data.minBathDay}人`, hint: '最低配置' },
    { label: '休日', value: `${data.targetOffDays}日`, hint: '月間目標休日数' },
  ]

  return (
    <div className="flex items-center gap-1.5 flex-wrap" aria-label="制約条件サマリー">
      <span className="text-[10px] text-gray-400 font-medium shrink-0">制約:</span>
      {items.map(({ label, value, hint }) => (
        <div
          key={label}
          title={hint}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-100"
        >
          <span className="text-[10px] text-rose-400 font-medium">{label}</span>
          <span className="text-[10px] text-gray-600 font-semibold">{value}</span>
        </div>
      ))}
    </div>
  )
}
