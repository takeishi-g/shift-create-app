import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getDaysInMonth, getDay } from 'date-fns'
import { generateShifts } from '@/lib/shift-solver'
import { generateShiftsFallback } from '@/lib/shift-solver-fallback'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const year_month: string = body?.year_month ?? ''
  const bathDayIndicesFromUI: number[] | null = Array.isArray(body?.bath_day_indices) ? body.bath_day_indices : null

  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json({ error: 'year_month は "YYYY-MM" 形式で指定してください' }, { status: 400 })
  }

  const supabase = await createClient()
  const [year, month] = year_month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const monthStart = `${year_month}-01`
  const monthEnd   = `${year_month}-${String(daysInMonth).padStart(2, '0')}`

  // クライアントから前月末データが渡された場合は優先使用
  // なければ確定済みの shift_assignments から取得（フォールバック）
  type TailEntry = { staff_id: string; shift_code: string; day: number }
  const tailFromBody: TailEntry[] | null = Array.isArray(body?.prev_month_tail) ? body.prev_month_tail : null

  const prevMonthDate = new Date(year, month - 2, 1)
  const prevYear = prevMonthDate.getFullYear()
  const prevMonth = prevMonthDate.getMonth() + 1
  const prevDays = getDaysInMonth(prevMonthDate)
  const prevLastDay   = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDays).padStart(2, '0')}`
  const prevSecondLast = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDays - 1).padStart(2, '0')}`

  const [
    { data: staff, error: staffErr },
    { data: constraintsByMonth },
    { data: constraintsFallback },
    { data: leaveRequests },
    { data: pairConstraints },
    { data: prevTailRaw },
  ] = await Promise.all([
    supabase.from('staff_profiles').select('*').eq('is_active', true).order('created_at'),
    supabase.from('shift_constraints').select('*').eq('year_month', year_month).maybeSingle(),
    supabase.from('shift_constraints').select('*').is('year_month', null).limit(1).maybeSingle(),
    supabase.from('leave_requests').select('*, preferred_shift_type:shift_types(name, is_overnight)').gte('date', monthStart).lte('date', monthEnd),
    supabase.from('staff_pair_constraints').select('*, shift_type:shift_types(id, name, is_overnight, is_off)'),
    tailFromBody ? Promise.resolve({ data: null }) :
      supabase.from('shift_assignments').select('staff_id, shift_code, date').in('date', [prevSecondLast, prevLastDay]),
  ])

  const prevMonthTail: TailEntry[] = tailFromBody ?? (prevTailRaw ?? []).map((r) => ({
    staff_id: r.staff_id as string,
    shift_code: (r.shift_code ?? '') as string,
    day: Number((r.date as string).split('-')[2]),
  }))

  if (staffErr || !staff || staff.length === 0) {
    return NextResponse.json({ error: 'スタッフが登録されていません' }, { status: 400 })
  }

  const constraints = constraintsByMonth ?? constraintsFallback ?? null

  // 画面側で選択済みの場合はそれを優先、なければ制約設定の bath_days_of_week から計算
  const bathDayIndices: number[] = bathDayIndicesFromUI ?? (() => {
    const bathDowList: number[] = Array.isArray(constraints?.bath_days_of_week)
      ? (constraints.bath_days_of_week as number[])
      : [1, 4]
    const indices: number[] = []
    for (let i = 0; i < daysInMonth; i++) {
      if (bathDowList.includes(getDay(new Date(year, month - 1, i + 1)))) indices.push(i)
    }
    return indices
  })()

  const solverInput = {
    yearMonth: year_month,
    staff,
    constraints: constraints ?? null,
    leaveRequests: leaveRequests ?? [],
    pairConstraints: pairConstraints ?? [],
    bathDayIndices,
    prevMonthTail,
  }

  let { grid, warnings, targetOffDays } = await generateShifts(solverInput)

  const isInfeasible = warnings.some(
    (w) => w.includes('制約が充足不能') || w.includes('ILP') || w.includes('GLPK') || w.includes('空シフト'),
  )
  if (isInfeasible) {
    const fallback = await generateShiftsFallback(solverInput)
    grid = fallback.grid
    warnings = fallback.warnings
    targetOffDays = fallback.targetOffDays
  }

  return NextResponse.json({ grid, warnings, targetOffDays })
}
