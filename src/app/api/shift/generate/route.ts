import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getDaysInMonth, getDay } from 'date-fns'
import { generateShifts } from '@/lib/shift-solver'
import { generateShiftsFallback } from '@/lib/shift-solver-fallback'

// シフト生成はGLPKソルバーを同期実行するため時間がかかる。Vercel関数のデフォルト上限では
// ソルバーの制限時間(tmlim)前に関数が打ち切られうるため、明示的に上限を延長する。
// 探索時間自体は SHIFT_SOLVER_TMLIM（既定30秒）で制御。
// 注: 定休整合をハードで解けない稀な月はソフトで再解する（二段求解）。通常は単段で約40秒以内に収まるが、
//     再解が走る稀な月は最大で約2倍かかりうる。頻発する場合は SHIFT_SOLVER_TMLIM を下げるか、
//     Pro プランで maxDuration を引き上げる。
export const maxDuration = 60

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const year_month: string = body?.year_month ?? ''
  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json({ error: 'year_month は "YYYY-MM" 形式で指定してください' }, { status: 400 })
  }

  const supabase = await createClient()
  const [year, month] = year_month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))

  const bathDayIndicesFromUI: number[] | null =
    Array.isArray(body?.bath_day_indices) &&
    body.bath_day_indices.every((x: unknown) => typeof x === 'number' && (x as number) >= 0 && (x as number) < daysInMonth)
      ? body.bath_day_indices
      : null
  const monthStart = `${year_month}-01`
  const monthEnd   = `${year_month}-${String(daysInMonth).padStart(2, '0')}`

  const prevMonthDate = new Date(year, month - 2, 1)
  const prevYear = prevMonthDate.getFullYear()
  const prevMonth = prevMonthDate.getMonth() + 1
  const prevDays = getDaysInMonth(prevMonthDate)
  const prevLastDay   = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDays).padStart(2, '0')}`
  const prevSecondLast = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDays - 1).padStart(2, '0')}`

  // クライアントから前月末データが渡された場合は優先使用
  // なければ確定済みの shift_assignments から取得（フォールバック）
  type TailEntry = { staff_id: string; shift_code: string; day: number }
  const validTailCodes = new Set(['日', '夜', '明', '公', '有', '他', '希休', ''])
  let tailFromBodyHasInvalidEntry = false
  const tailFromBody: TailEntry[] | null = Array.isArray(body?.prev_month_tail)
    ? body.prev_month_tail.flatMap((entry: unknown) => {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as TailEntry).staff_id !== 'string' ||
          typeof (entry as TailEntry).shift_code !== 'string' ||
          typeof (entry as TailEntry).day !== 'number'
        ) {
          tailFromBodyHasInvalidEntry = true
          return []
        }

        const tailEntry = entry as TailEntry
        if (
          !Number.isInteger(tailEntry.day) ||
          (tailEntry.day !== prevDays - 1 && tailEntry.day !== prevDays) ||
          !validTailCodes.has(tailEntry.shift_code)
        ) {
          tailFromBodyHasInvalidEntry = true
          return []
        }

        return [tailEntry]
      })
    : null

  if (tailFromBodyHasInvalidEntry) {
    return NextResponse.json({ error: 'prev_month_tail は前月末2日分の有効なシフトデータのみ指定できます' }, { status: 400 })
  }

  const [
    { data: staff, error: staffErr },
    { data: constraintsByMonth },
    { data: constraintsFallback },
    { data: leaveRequests },
    { data: pairConstraints },
    { data: shiftTypes },
    { data: prevTailRaw },
    { data: carryOversRaw },
    { data: customHolidaysRaw },
  ] = await Promise.all([
    supabase.from('staff_profiles').select('*').eq('is_active', true).order('sort_order').order('created_at'),
    supabase.from('shift_constraints').select('*').eq('year_month', year_month).maybeSingle(),
    supabase.from('shift_constraints').select('*').is('year_month', null).limit(1).maybeSingle(),
    supabase.from('leave_requests').select('*, preferred_shift_type:shift_types(name, is_overnight)').gte('date', monthStart).lte('date', monthEnd),
    supabase.from('staff_pair_constraints').select('*, shift_type:shift_types(id, name, is_overnight, is_off)'),
    supabase.from('shift_types').select('*').order('display_order'),
    tailFromBody ? Promise.resolve({ data: null }) :
      supabase.from('shift_assignments').select('staff_id, shift_code, date').in('date', [prevSecondLast, prevLastDay]),
    supabase.from('staff_carry_over').select('staff_id, carry_over_days').eq('to_month', year_month),
    supabase.from('custom_holidays').select('date').gte('date', monthStart).lte('date', monthEnd),
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

  const carryOverByStaff: Record<string, number> = {}
  for (const co of carryOversRaw ?? []) {
    carryOverByStaff[co.staff_id as string] = co.carry_over_days as number
  }

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
    shiftTypes: shiftTypes ?? [],
    bathDayIndices,
    prevMonthTail,
    carryOverByStaff,
    customHolidayDates: (customHolidaysRaw ?? []).map((h) => h.date as string),
  }

  let { grid, warnings, targetOffDays, solverStatus } = await generateShifts(solverInput)
  const primarySolverStatus = solverStatus
  let resultStatus = solverStatus
  let fallbackUsed = false

  // supply-error は供給不足（夜勤・日勤の設定値が根本的に不足）なのでフォールバックでも解決できない
  if (solverStatus !== 'success' && solverStatus !== 'supply-error') {
    const fallback = await generateShiftsFallback(solverInput)
    grid = fallback.grid
    warnings = fallback.warnings
    targetOffDays = fallback.targetOffDays
    resultStatus = fallback.solverStatus
    fallbackUsed = true
  }

  return NextResponse.json({
    grid,
    warnings,
    targetOffDays,
    solverStatus: primarySolverStatus,
    resultStatus,
    fallbackUsed,
  })
}
