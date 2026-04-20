import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getDaysInMonth, getDay } from 'date-fns'
import { generateShifts } from '@/lib/shift-solver'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const year_month: string = body?.year_month ?? ''

  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json({ error: 'year_month は "YYYY-MM" 形式で指定してください' }, { status: 400 })
  }

  const supabase = await createClient()
  const [year, month] = year_month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const monthStart = `${year_month}-01`
  const monthEnd   = `${year_month}-${String(daysInMonth).padStart(2, '0')}`

  const [
    { data: staff, error: staffErr },
    { data: constraintsByMonth },
    { data: constraintsFallback },
    { data: leaveRequests },
    { data: pairConstraints },
  ] = await Promise.all([
    supabase.from('staff_profiles').select('*').eq('is_active', true).order('created_at'),
    supabase.from('shift_constraints').select('*').eq('year_month', year_month).maybeSingle(),
    supabase.from('shift_constraints').select('*').is('year_month', null).limit(1).maybeSingle(),
    supabase.from('leave_requests').select('*').gte('date', monthStart).lte('date', monthEnd),
    supabase.from('staff_pair_constraints').select('*'),
  ])

  if (staffErr || !staff || staff.length === 0) {
    return NextResponse.json({ error: 'スタッフが登録されていません' }, { status: 400 })
  }

  const constraints = constraintsByMonth ?? constraintsFallback ?? null

  // bath_days_of_week から bathDayIndices を計算
  const bathDowList: number[] = Array.isArray(constraints?.bath_days_of_week)
    ? (constraints.bath_days_of_week as number[])
    : [1, 4]
  const bathDayIndices: number[] = []
  for (let i = 0; i < daysInMonth; i++) {
    if (bathDowList.includes(getDay(new Date(year, month - 1, i + 1)))) {
      bathDayIndices.push(i)
    }
  }

  const { grid, warnings } = generateShifts({
    yearMonth: year_month,
    staff,
    constraints: constraints ?? null,
    leaveRequests: leaveRequests ?? [],
    pairConstraints: pairConstraints ?? [],
    bathDayIndices,
  })

  return NextResponse.json({ grid, warnings })
}
