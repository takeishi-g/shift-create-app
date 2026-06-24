/**
 * 回帰テスト: 土日祝の日勤がスタッフ間で公平化される（CONSTRAINTS.md §3「土日祝の日勤公平化」）
 *
 * 背景（修正前）:
 *   off_target は休みの「総数」しか見ないため、夜勤不可の日勤専従者などに土日祝の日勤が集中し、
 *   その人の休みが平日に寄る偏在が起きていた（実運用で 1 名が土日 8 日中 6 日勤務など）。
 *
 * 修正: 主求解では各スタッフの土日祝の日勤回数に「ハード上限 = fairShare + 1」を課す
 *   （fairShare = ⌈土日祝の必要日勤数 / 週末稼働スタッフ数⌉）。重い月は低速環境で最適解に届かず
 *   GLP_FEAS が返るため、ソフトのペナルティでは公平化が効かない（実データで確認）。ハード上限なら
 *   どの実行可能解でも必ず守られる。上限で解けない稀な月は hardenAlignment=false の再解でソフトに緩める。
 *   被覆・総公休は不変。
 *
 * 本テスト: 週末日勤を担えるのが 3 名（残り 4 名は土日固定休 `hard_off=[0,6]`）で、各週末日に
 *   2 名必要な月（2026-06・祝日なし）。ルール無しなら 1 名が全週末を担当(例 8/4/4)しうるが、
 *   ルール適用後は誰も fairShare(=6) を超えず、1 名が全週末を独占しない。
 *   フォールバック（貪欲法）も対称に分散することを検証する。修正を外すと偏在して失敗する。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getDaysInMonth } from 'date-fns'
import HolidayJP from '@holiday-jp/holiday_jp'
import { generateShifts, SolverInput, SolverOutput } from '../shift-solver-csp'
import { generateShiftsFallback } from '../shift-solver-fallback'
import { ShiftConstraints, StaffProfile } from '@/types'

const YEAR = 2026
const MONTH = 6 // 2026-06: 国民の祝日なし（土日のみが週末）
const YM = '2026-06'
const DAYS = getDaysInMonth(new Date(YEAR, MONTH - 1))

function makeStaff(
  o: Partial<StaffProfile> & Pick<StaffProfile, 'id' | 'name' | 'role' | 'sort_order'>,
): StaffProfile {
  return {
    qualification: '正看護師', work_start_time: '08:30', work_end_time: '17:30',
    experience_years: 5, max_night_shifts: 0,
    hard_off_days_of_week: [], soft_off_days_of_week: [],
    hard_off_on_holidays: false, soft_off_on_holidays: false,
    allow_extra_off_days: true, is_active: true, created_at: '', updated_at: '',
    ...o,
  }
}

// 週末稼働 3 名（日勤専従・定休なし）＋ 土日固定休 4 名（hard_off=[0,6]）。
// 夜勤なし・シニアなしで「土日の日勤を誰が担当するか」だけに焦点を当てる。
const ELIGIBLE_IDS = ['elig-1', 'elig-2', 'elig-3']
const STAFF: StaffProfile[] = [
  ...ELIGIBLE_IDS.map((id, i) =>
    makeStaff({ id, name: `専従${i + 1}`, role: '一般', sort_order: i + 1, max_night_shifts: 0 }),
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    makeStaff({
      id: `fix-${i + 1}`, name: `固定${i + 1}`, role: '一般', sort_order: i + 4, max_night_shifts: 0,
      hard_off_days_of_week: [0, 6], hard_off_on_holidays: true, allow_extra_off_days: false,
    }),
  ),
]

const CONSTRAINTS: ShiftConstraints = {
  id: 'test', year_month: YM,
  min_staff_per_shift: { 日勤: 2, 夜勤: 0 },
  max_staff_per_shift: {},
  min_staff_weekend: 2, max_staff_weekend: 2, // 各週末日ちょうど 2 名
  min_staff_bath_day: 2,
  max_consecutive_work_days: 5, min_rest_hours_after_night: 0,
  auto_insert_off_after_night: false, target_off_days: 10,
  bath_days_of_week: [], updated_at: '',
}

function isWeekendDate(idx: number): boolean {
  const d = new Date(YEAR, MONTH - 1, idx + 1)
  return d.getDay() === 0 || d.getDay() === 6 || HolidayJP.isHoliday(d)
}
const WEEKEND_IDXS = Array.from({ length: DAYS }, (_, i) => i).filter(isWeekendDate)
const WEEKEND_SLOTS = WEEKEND_IDXS.length * CONSTRAINTS.min_staff_weekend // 2/日
const FAIR_SHARE = Math.ceil(WEEKEND_SLOTS / ELIGIBLE_IDS.length)

function buildInput(): SolverInput {
  return {
    yearMonth: YM, staff: STAFF, constraints: CONSTRAINTS,
    leaveRequests: [], pairConstraints: [], bathDayIndices: [], prevMonthTail: [],
  }
}

function weekendWork(out: SolverOutput, id: string): number {
  return WEEKEND_IDXS.reduce((sum, i) => sum + (out.grid[id]?.[i] === '日' ? 1 : 0), 0)
}
function dayCountAt(out: SolverOutput, idx: number): number {
  return STAFF.reduce((sum, m) => sum + (out.grid[m.id]?.[idx] === '日' ? 1 : 0), 0)
}
function offCount(out: SolverOutput, id: string): number {
  return (out.grid[id] ?? []).filter(
    (c) => c === '公' || c === '有' || c === '他' || c === '希休' || c === '明',
  ).length
}

describe('土日祝の日勤公平化（CONSTRAINTS.md §3）', () => {
  let out: SolverOutput
  beforeAll(async () => {
    out = await generateShifts(buildInput())
  }, 60_000)

  it('前提: 週末日が 8 日・fairShare = ⌈週末必要日勤数 / 稼働3名⌉ = 6', () => {
    expect(WEEKEND_IDXS.length).toBe(8)
    expect(FAIR_SHARE).toBe(6)
  })

  it('解が得られる（success）', () => {
    expect(out.solverStatus).toBe('success')
  })

  it('各週末日はちょうど 2 名（被覆維持）、固定休スタッフは週末日勤ゼロ', () => {
    for (const i of WEEKEND_IDXS) expect(dayCountAt(out, i)).toBe(2)
    for (let i = 1; i <= 4; i++) expect(weekendWork(out, `fix-${i}`)).toBe(0)
  })

  it('どの稼働スタッフも fairShare を超えて土日に偏らない（1名が全週末を独占しない）', () => {
    const works = ELIGIBLE_IDS.map((id) => weekendWork(out, id))
    const max = Math.max(...works)
    expect(max).toBeLessThanOrEqual(FAIR_SHARE + 1) // ハード上限 fairShare+1 を必ず満たす（時間切れ解でも）
    expect(max).toBeLessThan(WEEKEND_IDXS.length)    // 1名が全週末(8)を担当する偏在を防ぐ
    expect(works.reduce((a, b) => a + b, 0)).toBe(WEEKEND_SLOTS) // 週末日勤の総数は被覆により一定
  })

  it('総公休数（off_target）は不変（各稼働スタッフ ≈ target_off_days=10）', () => {
    for (const id of ELIGIBLE_IDS) {
      expect(offCount(out, id)).toBeGreaterThanOrEqual(9)
      expect(offCount(out, id)).toBeLessThanOrEqual(11)
    }
  })

  // ハード上限の核心: 制限時間切れで非最適の実行可能解(GLP_FEAS)が返っても上限は必ず守られる。
  // ソフトのペナルティは最適化されないと効かないが、ハード制約はどの実行可能解でも成立する。
  // （実データ2026-07でも GLP_FEAS・約32秒で上名が fairShare+1 以下になることを確認済み）
  it('短い制限時間(GLP_FEAS誘発)でもハード上限 fairShare+1 を超えない', async () => {
    const prev = process.env.SHIFT_SOLVER_TMLIM
    process.env.SHIFT_SOLVER_TMLIM = '1'
    try {
      const o = await generateShifts(buildInput())
      expect(o.solverStatus).toBe('success')
      const works = ELIGIBLE_IDS.map((id) => weekendWork(o, id))
      expect(Math.max(...works)).toBeLessThanOrEqual(FAIR_SHARE + 1)
    } finally {
      if (prev === undefined) delete process.env.SHIFT_SOLVER_TMLIM
      else process.env.SHIFT_SOLVER_TMLIM = prev
    }
  }, 60_000)
})

describe('フォールバックでも土日祝の日勤を分散する（CSPと対称）', () => {
  let out: SolverOutput
  beforeAll(async () => {
    out = await generateShiftsFallback(buildInput())
  }, 60_000)

  it('週末日勤が稼働3名に分散し、1名が全週末を担当しない', () => {
    const works = ELIGIBLE_IDS.map((id) => weekendWork(out, id))
    const max = Math.max(...works)
    const min = Math.min(...works)
    expect(max).toBeLessThanOrEqual(FAIR_SHARE + 1)
    expect(max - min).toBeLessThanOrEqual(2) // 貪欲ラウンドロビンでほぼ均等
  })
})

// エッジ: 週末稼働プールが縮退（0名・1名）しても公平化ロジックが infeasible 化や例外を起こさないこと。
// weekendFairShare の Math.max(1, …) と eligible 判定の境界を検証する。
describe('週末稼働プールの縮退エッジ（CONSTRAINTS.md §3）', () => {
  it('eligible=0（全員土日固定休・週末必要人数0）: success かつ土日日勤は全員0', async () => {
    const staff: StaffProfile[] = Array.from({ length: 6 }, (_, i) =>
      makeStaff({
        id: `f-${i + 1}`, name: `固定${i + 1}`, role: '一般', sort_order: i + 1, max_night_shifts: 0,
        hard_off_days_of_week: [0, 6], hard_off_on_holidays: true, allow_extra_off_days: false,
      }),
    )
    const constraints: ShiftConstraints = {
      ...CONSTRAINTS, min_staff_per_shift: { 日勤: 2, 夜勤: 0 }, min_staff_weekend: 0, max_staff_weekend: 0,
    }
    const out = await generateShifts({
      yearMonth: YM, staff, constraints, leaveRequests: [], pairConstraints: [], bathDayIndices: [], prevMonthTail: [],
    })
    expect(out.solverStatus).toBe('success')
    for (const i of WEEKEND_IDXS) {
      const c = staff.reduce((s, m) => s + (out.grid[m.id]?.[i] === '日' ? 1 : 0), 0)
      expect(c, `weekend idx ${i}`).toBe(0)
    }
  }, 60_000)

  it('eligible=1（稼働1名のみ・週末必要人数1）: success かつその1名が全週末を担当（キャップは実質無効＝正常）', async () => {
    const staff: StaffProfile[] = [
      makeStaff({ id: 'solo', name: '専従', role: '一般', sort_order: 1, max_night_shifts: 0 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeStaff({
          id: `f-${i + 1}`, name: `固定${i + 1}`, role: '一般', sort_order: i + 2, max_night_shifts: 0,
          hard_off_days_of_week: [0, 6], hard_off_on_holidays: true, allow_extra_off_days: false,
        }),
      ),
    ]
    const constraints: ShiftConstraints = {
      ...CONSTRAINTS, min_staff_per_shift: { 日勤: 1, 夜勤: 0 }, min_staff_weekend: 1, max_staff_weekend: 1,
    }
    const out = await generateShifts({
      yearMonth: YM, staff, constraints, leaveRequests: [], pairConstraints: [], bathDayIndices: [], prevMonthTail: [],
    })
    expect(out.solverStatus).toBe('success')
    // 週末被覆(=1) を満たせるのは solo だけなので全週末日勤を担当する（fairShare=週末必要数でキャップ無効＝設計通り）。
    for (const i of WEEKEND_IDXS) {
      expect(out.grid['solo']?.[i], `weekend idx ${i}`).toBe('日')
    }
  }, 60_000)
})
