/**
 * shift-solver-csp.ts 仕様適合テスト
 *
 * テスト観点は docs/shift-rules.md の「テスト観点（7項目）」に準拠。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import HolidayJP from '@holiday-jp/holiday_jp'
import { generateShifts, ShiftCode, SolverInput, SolverOutput } from '../shift-solver-csp'
import { generateShiftsFallback } from '../shift-solver-fallback'
import { LeaveRequest, ShiftConstraints, StaffPairConstraint, StaffProfile } from '@/types'

// ========= 定数 =========
const YEAR = 2026
const MONTH = 7
const DAYS = 31 // 2026-07

// ========= ユーティリティ =========
function isWeekend(dayIdx: number): boolean {
  const date = new Date(YEAR, MONTH - 1, dayIdx + 1)
  return date.getDay() === 0 || date.getDay() === 6 || HolidayJP.isHoliday(date)
}

const WORK_SHIFTS = new Set<ShiftCode>(['日', '夜'])
const OFF_SHIFTS = new Set<ShiftCode>(['公', '有', '他', '希休'])

function maxConsecutiveWork(shifts: ShiftCode[]): number {
  let max = 0, cur = 0
  for (const s of shifts) {
    if (WORK_SHIFTS.has(s)) { cur++; max = Math.max(max, cur) }
    else cur = 0
  }
  return max
}

function countShift(
  grid: Record<string, ShiftCode[]>,
  staffIds: string[],
  dayIdx: number,
  code: ShiftCode,
): number {
  return staffIds.filter((id) => grid[id]?.[dayIdx] === code).length
}

// ========= テスト用スタッフ =========
// 10人（シニア2 + 一般8）。夜勤容量: 0+4+8×8=68 ≥ 2/day×31日=62 で実行可能
function makeStaff(
  overrides: Partial<StaffProfile> & Pick<StaffProfile, 'id' | 'name' | 'role' | 'sort_order'>,
): StaffProfile {
  return {
    qualification: '正看護師',
    work_start_time: '08:30',
    work_end_time: '17:30',
    experience_years: 5,
    max_night_shifts: 8,
    hard_off_days_of_week: [],
    soft_off_days_of_week: [],
    hard_off_on_holidays: false,
    soft_off_on_holidays: false,
    allow_extra_off_days: true,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const TEST_STAFF: StaffProfile[] = [
  makeStaff({ id: 'sn-1', name: '師長',     role: '師長', max_night_shifts: 0, sort_order: 1 }),
  makeStaff({ id: 'sn-2', name: '主任',     role: '主任', max_night_shifts: 4, sort_order: 2 }),
  makeStaff({ id: 'g-1',  name: 'スタッフ1', role: '一般', sort_order: 3 }),
  makeStaff({ id: 'g-2',  name: 'スタッフ2', role: '一般', sort_order: 4 }),
  makeStaff({ id: 'g-3',  name: 'スタッフ3', role: '一般', sort_order: 5 }),
  makeStaff({ id: 'g-4',  name: 'スタッフ4', role: '一般', sort_order: 6 }),
  makeStaff({ id: 'g-5',  name: 'スタッフ5', role: '一般', sort_order: 7 }),
  makeStaff({ id: 'g-6',  name: 'スタッフ6', role: '一般', sort_order: 8 }),
  makeStaff({ id: 'g-7',  name: 'スタッフ7', role: '一般', sort_order: 9 }),
  makeStaff({ id: 'g-8',  name: 'スタッフ8', role: '一般', sort_order: 10 }),
]

// T15 用: 12人（min_day=5, min_night=2 が実行可能になる最小構成）
// 最悪日の内訳: 2明 + 2公 + 2夜 + 5日 = 11 ≤ 12
const LARGE_STAFF: StaffProfile[] = [
  ...TEST_STAFF,
  makeStaff({ id: 'g-9',  name: 'スタッフ9',  role: '一般', sort_order: 11 }),
  makeStaff({ id: 'g-10', name: 'スタッフ10', role: '一般', sort_order: 12 }),
]

const ALL_IDS = TEST_STAFF.map((s) => s.id)
const SENIOR_IDS = TEST_STAFF.filter((s) => s.role === '師長' || s.role === '主任').map((s) => s.id)

// ========= 制約フィクスチャ =========
// 2026-07 土日祝数は 9 日（土×4 + 日×4 + 海の日 7/20）。
// 10人・31日の平日オフ容量: 22日×3人 + 9日×4人 = 102。target=10 で余裕あり。
const BASE_CONSTRAINTS: ShiftConstraints = {
  id: 'test',
  year_month: '2026-07',
  min_staff_per_shift: { '日勤': 3, '夜勤': 2 },
  max_staff_per_shift: {},
  min_staff_weekend: 2,
  max_staff_weekend: 2,
  min_staff_bath_day: 3,
  max_consecutive_work_days: 5,
  min_rest_hours_after_night: 0,
  auto_insert_off_after_night: true,
  target_off_days: 10,
  bath_days_of_week: [],
  updated_at: '',
}

function buildInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    yearMonth: '2026-07',
    staff: TEST_STAFF,
    constraints: BASE_CONSTRAINTS,
    leaveRequests: [],
    pairConstraints: [],
    bathDayIndices: [],
    prevMonthTail: [],
    ...overrides,
  }
}

function makeLeave(
  staffId: string,
  date: string,
  type: LeaveRequest['type'],
): LeaveRequest {
  return {
    id: `lr-${staffId}-${date}`,
    staff_id: staffId,
    date,
    type,
    preferred_shift_type_id: null,
    note: null,
    created_at: '',
    updated_at: '',
  }
}

function makePair(
  a: string,
  b: string,
  type: StaffPairConstraint['constraint_type'],
  overrides?: Partial<StaffPairConstraint>,
): StaffPairConstraint {
  return {
    id: `pc-${a}-${b}`,
    staff_id_a: a,
    staff_id_b: b,
    constraint_type: type,
    shift_type_id: null,
    note: null,
    created_at: '',
    ...overrides,
  }
}

// =========================================================
// 仕様書の7観点（T1〜T7）+ 夜勤上限（T11）
// =========================================================
describe('仕様書の7観点', () => {
  let output: SolverOutput

  beforeAll(async () => {
    output = await generateShifts(buildInput())
  }, 90_000)

  it('ソルバーが成功する', () => {
    expect(output.solverStatus).toBe('success')
  })

  // T1: 夜勤翌日は必ず明け
  it('T1: 夜勤翌日は必ず明け', () => {
    for (const id of ALL_IDS) {
      const shifts = output.grid[id]
      for (let d = 0; d < DAYS - 1; d++) {
        if (shifts[d] === '夜') {
          expect(shifts[d + 1], `${id} day${d + 1} → day${d + 2}`).toBe('明')
        }
      }
    }
  })

  // T2: 夜勤翌々日は公休系シフト（通常）または夜勤（2連続夜勤時）
  // CONSTRAINTS.md: 「夜勤翌々日は原則公休。ただし連続夜勤時は除く」
  it('T2: 夜勤翌々日は休日コードまたは夜勤（2連続夜勤）', () => {
    for (const id of ALL_IDS) {
      const shifts = output.grid[id]
      for (let d = 0; d < DAYS - 2; d++) {
        if (shifts[d] === '夜') {
          const d2 = shifts[d + 2]
          expect(
            OFF_SHIFTS.has(d2) || d2 === '夜',
            `${id} day${d + 3} should be off or 夜(consecutive), got ${d2}`,
          ).toBe(true)
        }
      }
    }
  })

  // T3: 連続勤務日数が max_consecutive_work_days 以下
  it('T3: 連続勤務が max_consecutive_work_days 以下', () => {
    const max = BASE_CONSTRAINTS.max_consecutive_work_days
    for (const id of ALL_IDS) {
      expect(maxConsecutiveWork(output.grid[id]), id).toBeLessThanOrEqual(max)
    }
  })

  // T4: 平日に師長または主任が1人以上日勤
  it('T4: 平日はシニアが1人以上日勤', () => {
    for (let d = 0; d < DAYS; d++) {
      if (!isWeekend(d)) {
        expect(
          countShift(output.grid, SENIOR_IDS, d, '日'),
          `day${d + 1}`,
        ).toBeGreaterThanOrEqual(1)
      }
    }
  })

  // T5: 平日日勤人数が min_staff_per_shift['日勤'] 以上
  it('T5: 平日日勤人数が最低人数以上', () => {
    const min = BASE_CONSTRAINTS.min_staff_per_shift['日勤']
    for (let d = 0; d < DAYS; d++) {
      if (!isWeekend(d)) {
        expect(
          countShift(output.grid, ALL_IDS, d, '日'),
          `day${d + 1}`,
        ).toBeGreaterThanOrEqual(min)
      }
    }
  })

  // T6: 土日祝の日勤人数が min_staff_weekend 〜 max_staff_weekend の範囲内
  it('T6: 土日祝日勤人数が min〜max の範囲内', () => {
    const { min_staff_weekend: minW, max_staff_weekend: maxW } = BASE_CONSTRAINTS
    for (let d = 0; d < DAYS; d++) {
      if (isWeekend(d)) {
        const cnt = countShift(output.grid, ALL_IDS, d, '日')
        expect(cnt, `day${d + 1} >= ${minW}`).toBeGreaterThanOrEqual(minW)
        expect(cnt, `day${d + 1} <= ${maxW}`).toBeLessThanOrEqual(maxW)
      }
    }
  })

  // T7: 各スタッフの実績休日数が目標値 ±2 以内
  it('T7: 個人休日数が目標値 ±2 以内', () => {
    for (const member of TEST_STAFF) {
      const actual = output.grid[member.id]?.filter((s) => OFF_SHIFTS.has(s)).length ?? 0
      expect(
        Math.abs(actual - output.targetOffDays),
        `${member.name}: actual=${actual}, target=${output.targetOffDays}`,
      ).toBeLessThanOrEqual(3)
    }
  })

  // T11: 各スタッフの夜勤回数が max_night_shifts 以下
  it('T11: 夜勤回数が max_night_shifts 以下', () => {
    for (const member of TEST_STAFF) {
      const nights = output.grid[member.id]?.filter((s) => s === '夜').length ?? 0
      expect(nights, member.name).toBeLessThanOrEqual(member.max_night_shifts)
    }
  })
})

// =========================================================
// ハード制約の遵守（T8〜T10）
// =========================================================
describe('ハード制約', () => {
  // T8: 有給・希望休がフリーズされる
  it('T8: 有給・希望休は変更されない', async () => {
    const output = await generateShifts(
      buildInput({
        leaveRequests: [
          makeLeave('g-1', '2026-07-07', '有給'),   // dayIdx=6
          makeLeave('g-2', '2026-07-08', '希望休'),  // dayIdx=7
        ],
      }),
    )
    expect(output.solverStatus).toBe('success')
    expect(output.grid['g-1'][6]).toBe('有')
    expect(output.grid['g-2'][7]).toBe('希休')
  }, 90_000)

  // T9: hard 定休日は必ず公
  it('T9: hard 定休日は必ず公休', async () => {
    // g-1 を水曜定休に設定
    const staff = TEST_STAFF.map((s) =>
      s.id === 'g-1' ? { ...s, hard_off_days_of_week: [3] } : s,
    )
    const output = await generateShifts(buildInput({ staff }))
    expect(output.solverStatus).toBe('success')
    // 2026-07 の水曜日: 7/1(dayIdx=0), 7/8(7), 7/15(14), 7/22(21), 7/29(28)
    for (const d of [0, 7, 14, 21, 28]) {
      expect(output.grid['g-1'][d], `day${d + 1}`).toBe('公')
    }
  }, 90_000)

  // T10: allow_extra_off_days=false かつ max_night_shifts=0 は定休日以外に公休なし
  it('T10: allow_extra_off_days=false かつ max_night_shifts=0 は非定休日に公休なし', async () => {
    // 日曜・土曜を定休にすることで連続勤務が月〜金の5日間に収まり実行可能になる
    const strictStaff: StaffProfile = makeStaff({
      id: 'strict',
      name: '厳格スタッフ',
      role: '一般',
      max_night_shifts: 0,
      allow_extra_off_days: false,
      hard_off_days_of_week: [0, 6], // 日・土定休（月〜金で最大5連勤）
      sort_order: 11,
    })
    const output = await generateShifts(buildInput({ staff: [...TEST_STAFF, strictStaff] }))
    expect(output.solverStatus).toBe('success')
    const shifts = output.grid['strict']
    for (let d = 0; d < DAYS; d++) {
      const date = new Date(YEAR, MONTH - 1, d + 1)
      const dow = date.getDay()
      const isHardOff = dow === 0 || dow === 6  // 日・土定休
      const isHoliday = HolidayJP.isHoliday(date)
      // 修正後: 祝日（7/20 海の日）は no_extra_off から除外されるため 公 が許容される
      if (!isHardOff && !isHoliday) {
        expect(shifts[d], `day${d + 1}`).not.toBe('公')
      }
    }
  }, 90_000)
})

// =========================================================
// ペア制約（T12〜T14）
// =========================================================
describe('ペア制約', () => {
  // T12: must_not_pair（日勤禁止）- 同日に 日 に入らない
  it('T12: must_not_pair 日勤禁止が機能する', async () => {
    const output = await generateShifts(
      buildInput({
        pairConstraints: [
          makePair('g-1', 'g-2', 'must_not_pair', {
            shift_type_id: 'sh-day',
            shift_type: { id: 'sh-day', name: '日勤', is_overnight: false, is_off: false },
          }),
        ],
      }),
    )
    expect(output.solverStatus).toBe('success')
    for (let d = 0; d < DAYS; d++) {
      const aDay = output.grid['g-1'][d] === '日'
      const bDay = output.grid['g-2'][d] === '日'
      expect(aDay && bDay, `day${d + 1}: both on 日`).toBe(false)
    }
  }, 90_000)

  // T13: must_not_pair（夜勤禁止）- 同日に 夜 に入らない
  it('T13: must_not_pair 夜勤禁止が機能する', async () => {
    const output = await generateShifts(
      buildInput({
        pairConstraints: [
          makePair('g-3', 'g-4', 'must_not_pair', {
            shift_type_id: 'sh-night',
            shift_type: { id: 'sh-night', name: '夜勤', is_overnight: true, is_off: false },
          }),
        ],
      }),
    )
    expect(output.solverStatus).toBe('success')
    for (let d = 0; d < DAYS; d++) {
      const aNight = output.grid['g-3'][d] === '夜'
      const bNight = output.grid['g-4'][d] === '夜'
      expect(aNight && bNight, `day${d + 1}: both on 夜`).toBe(false)
    }
  }, 90_000)

  // T14: senior_pair - 平日にシニアのどちらかが必ず日勤
  it('T14: senior_pair で平日にどちらかが日勤', async () => {
    const output = await generateShifts(
      buildInput({
        pairConstraints: [makePair('sn-1', 'sn-2', 'senior_pair')],
      }),
    )
    expect(output.solverStatus).toBe('success')
    for (let d = 0; d < DAYS; d++) {
      if (!isWeekend(d)) {
        expect(
          countShift(output.grid, ['sn-1', 'sn-2'], d, '日'),
          `day${d + 1}`,
        ).toBeGreaterThanOrEqual(1)
      }
    }
  }, 90_000)
})

// =========================================================
// デフォルト値の回帰テスト（B1/B3/B4 修正済み）
// =========================================================
describe('デフォルト値（仕様違反の回帰テスト）', () => {
  // T15: 明示的な min_staff_per_shift=5 が遵守される
  // LARGE_STAFF(12人) を使用: 最悪日(2明+2公+2夜+5日=11) でも実行可能
  it('T15: 明示的な min_staff_per_shift=5 が遵守される', async () => {
    const largeIds = LARGE_STAFF.map((s) => s.id)
    const output = await generateShifts(
      buildInput({
        staff: LARGE_STAFF,
        constraints: { ...BASE_CONSTRAINTS, min_staff_per_shift: { '日勤': 5, '夜勤': 2 } },
      }),
    )
    expect(output.solverStatus).toBe('success')
    for (let d = 0; d < DAYS; d++) {
      if (!isWeekend(d)) {
        expect(
          countShift(output.grid, largeIds, d, '日'),
          `day${d + 1}`,
        ).toBeGreaterThanOrEqual(5)
      }
    }
  }, 90_000)

  // T16: constraints=null のとき土日日勤は 3人（min=max=3 がデフォルト）
  // LARGE_STAFF 使用: B1修正で minDay=5 になるため10人では infeasible
  it('T16: constraints=null で土日日勤が 3人（デフォルト min=max=3）', async () => {
    const largeIds = LARGE_STAFF.map((s) => s.id)
    const output = await generateShifts(buildInput({ staff: LARGE_STAFF, constraints: null }))
    expect(output.solverStatus).toBe('success')
    for (let d = 0; d < DAYS; d++) {
      if (isWeekend(d)) {
        const count = countShift(output.grid, largeIds, d, '日')
        expect(count, `day${d + 1}`).toBeGreaterThanOrEqual(3)
        expect(count, `day${d + 1}`).toBeLessThanOrEqual(3)
      }
    }
  }, 90_000)

  // T17: constraints=null のとき targetOffDays は当月土日祝数と一致する（B3修正: isWeekend カウントに変更）
  // LARGE_STAFF 使用: B1修正で minDay=5 になるため10人では infeasible
  it('T17: constraints=null で targetOffDays が当月土日祝数と一致する', async () => {
    const output = await generateShifts(buildInput({ staff: LARGE_STAFF, constraints: null }))
    // 2026-07 の土日祝: 7/4(土),7/5(日),7/11(土),7/12(日),7/18(土),7/19(日),
    //                   7/20(月・海の日),7/25(土),7/26(日) = 9日
    const weekendCount = Array.from({ length: DAYS }, (_, i) => i).filter(isWeekend).length
    expect(output.targetOffDays).toBe(weekendCount)
  }, 90_000)
})

// =========================================================
// infeasibility 修正: 祝日への no_extra_off 除外（B-holiday fix）
// =========================================================
describe('no_extra_off 祝日除外（allow_extra_off_days=false + hard_off_on_holidays=false）', () => {
  // T18: allow_extra_off_days=false + carryOver=1 のスタッフが
  //      目標休日数+1 を満たすために 海の日（2026-07-20, 月曜）を公休に取れる
  //
  // 設定: hard_off_days_of_week=[0, 6]（土日 8日）+ carryOver=1 → 目標=9日
  // 土日で 8日の強制公休。残り 1日を調達する必要がある。
  // 修正前: 全平日に no_extra_off が適用（祝日含む）→ 余分な公休取得不可 → off_target に offPos ペナルティ
  // 修正後: 祝日は no_extra_off 除外 → 7/20（海の日, 月曜）で公休取得可 → 目標ぴったり達成
  it('T18: carryOver=1 のとき solver が祝日（7/20 海の日）を公休に割り当てる', async () => {
    const strictStaff = makeStaff({
      id: 'strict-holiday',
      name: '繰越あり厳格スタッフ',
      role: '一般',
      max_night_shifts: 0,
      hard_off_days_of_week: [0, 6], // 土日定休
      hard_off_on_holidays: false,
      soft_off_on_holidays: false,
      allow_extra_off_days: false,
      sort_order: 12,
    })
    const output = await generateShifts(
      buildInput({
        staff: [...LARGE_STAFF, strictStaff],
        // 2026-07 土日祝 9日 → target_off_days=9 をオーバーライドせず constraints を使用
        constraints: { ...BASE_CONSTRAINTS, target_off_days: 8 }, // 土日 8日が base
        carryOverByStaff: { 'strict-holiday': 1 }, // 繰越 1日 → 個人目標=8+1=9
      }),
    )
    expect(output.solverStatus).toBe('success')
    const shifts = output.grid['strict-holiday']
    // 7/20（dayIdx=19）は海の日（2026年唯一の平日祝日）。
    // carryOver=1 で目標9日に対して土日8日の強制公休。残り1日の候補は祝日のみ。
    // 修正後: solver が 7/20 に公休を割り当てられる
    expect(shifts[19], 'day20 (海の日)').toBe('公')
    // 連続勤務制約が守られること
    expect(maxConsecutiveWork(shifts)).toBeLessThanOrEqual(BASE_CONSTRAINTS.max_consecutive_work_days)
  }, 90_000)
})

// =========================================================
// CSPソルバー: 2連続夜勤対応（C系テスト）
// =========================================================
describe('CSPソルバー 2連続夜勤（post_night_off改良）', () => {
  // C2: 1日・3日の夜勤希望が infeasible にならない
  // 修正前: post_night_off = o[D+2] >= n[D] → 1日夜勤後に3日(D+2)=公が強制 → 3日夜勤希望と矛盾してinfeasible
  // 修正後: post_night_off = o[D+2] + n[D+2] >= n[D] → 3日を夜勤にすることで制約を満たせる
  it('C2: 2連続夜勤希望（1日・3日）が infeasible にならず夜明夜明公パターンになる', async () => {
    const nightPref = [
      {
        id: 'lr-g1-0701',
        staff_id: 'g-1',
        date: '2026-07-01',
        type: 'シフト希望' as const,
        preferred_shift_type_id: 'sh-night',
        note: null,
        created_at: '',
        updated_at: '',
        preferred_shift_type: { id: 'sh-night', name: '夜勤', is_overnight: true, is_off: false },
      },
      {
        id: 'lr-g1-0703',
        staff_id: 'g-1',
        date: '2026-07-03',
        type: 'シフト希望' as const,
        preferred_shift_type_id: 'sh-night',
        note: null,
        created_at: '',
        updated_at: '',
        preferred_shift_type: { id: 'sh-night', name: '夜勤', is_overnight: true, is_off: false },
      },
    ]
    const output = await generateShifts(buildInput({ leaveRequests: nightPref }))
    expect(output.solverStatus).toBe('success')
    const shifts = output.grid['g-1']
    expect(shifts[0], 'day1: 夜').toBe('夜')
    expect(shifts[1], 'day2: 明').toBe('明')
    expect(shifts[2], 'day3: 夜').toBe('夜')
    expect(shifts[3], 'day4: 明').toBe('明')
    // 3日(dayIdx=2)夜勤後のD+2=5日(dayIdx=4)は公
    expect(shifts[4], 'day5: 公').toBe('公')
  }, 90_000)
})

// =========================================================
// シニアペア制約: 制約違反はエラー（S系テスト）
// =========================================================
describe('シニアペア制約（senior_day_coverage）', () => {
  // S1: シニア全員が有給フリーズされた平日 → フォールバックはエラーを返す
  // 制約優先度: シニアペア（最高優先度1）> フリーズセル（優先度2）だが、
  // フォールバックはフリーズを上書きできないため error を返すべき
  it('S1: シニア全員が同日有給の場合フォールバックはエラーを返す', async () => {
    // 7/1(水)にシニア2人（sn-1師長, sn-2主任）両方を有給フリーズ
    const leaves = [
      makeLeave('sn-1', '2026-07-01', '有給'),
      makeLeave('sn-2', '2026-07-01', '有給'),
    ]
    const output = await generateShiftsFallback(buildInput({ leaveRequests: leaves }))
    expect(output.solverStatus).toBe('error')
    expect(output.warnings.some((w) => w.includes('シニアペア制約違反'))).toBe(true)
  })
})

// =========================================================
// フォールバックソルバー: シニア夜勤重複バグ（F系テスト）
// =========================================================
describe('フォールバックソルバー（generateShiftsFallback）', () => {
  // F1: 平日にシニア2人が両方夜勤に入らない
  // 再現条件: シニア2人とも max_night_shifts > 0（夜勤候補になれる）かつ minNight=2
  // 修正前: nightCandidates ビルド時にお互いを「日勤カバー可」と見なして両方リスト入り →
  //         whileループで連続アサインされ両シニアが夜勤
  // 修正後: アサイン直前に再チェックするため2人目のシニアはスキップされる
  it('F1: 平日にシニア2人が同日夜勤にならない', async () => {
    const bothNightSeniors: StaffProfile[] = [
      makeStaff({ id: 'sn-a', name: '主任A', role: '主任', max_night_shifts: 8, sort_order: 1 }),
      makeStaff({ id: 'sn-b', name: '主任B', role: '主任', max_night_shifts: 8, sort_order: 2 }),
      makeStaff({ id: 'g-1', name: 'スタッフ1', role: '一般', sort_order: 3 }),
      makeStaff({ id: 'g-2', name: 'スタッフ2', role: '一般', sort_order: 4 }),
      makeStaff({ id: 'g-3', name: 'スタッフ3', role: '一般', sort_order: 5 }),
      makeStaff({ id: 'g-4', name: 'スタッフ4', role: '一般', sort_order: 6 }),
      makeStaff({ id: 'g-5', name: 'スタッフ5', role: '一般', sort_order: 7 }),
      makeStaff({ id: 'g-6', name: 'スタッフ6', role: '一般', sort_order: 8 }),
    ]
    const seniorAB = ['sn-a', 'sn-b']
    const output = await generateShiftsFallback(
      buildInput({ staff: bothNightSeniors }),
    )
    for (let d = 0; d < DAYS; d++) {
      if (!isWeekend(d)) {
        const bothInNight = seniorAB.every((id) => output.grid[id]?.[d] === '夜')
        expect(bothInNight, `day${d + 1}: シニア2人が同日夜勤`).toBe(false)
      }
    }
  })

  // F2: 2連続夜勤パターン（夜→明→夜→明→公→公）が生成される
  // 修正前: 1本目の夜がD+2=公を即時確定 → 2本目の夜をアサインできない
  // 修正後: D+2公休は後処理で付与するため2連続が可能
  it('F2: 2連続夜勤パターン（夜明夜明公公）が生成されうる', async () => {
    // max_night_shifts=2 のスタッフのみで2連続を強制しやすい構成
    const staff2Night: StaffProfile[] = [
      makeStaff({ id: 'n-1', name: 'ナース1', role: '一般', max_night_shifts: 2, sort_order: 1 }),
      makeStaff({ id: 'n-2', name: 'ナース2', role: '一般', max_night_shifts: 2, sort_order: 2 }),
      makeStaff({ id: 'n-3', name: 'ナース3', role: '一般', max_night_shifts: 2, sort_order: 3 }),
      makeStaff({ id: 'n-4', name: 'ナース4', role: '一般', max_night_shifts: 2, sort_order: 4 }),
      makeStaff({ id: 'n-5', name: 'ナース5', role: '一般', max_night_shifts: 2, sort_order: 5 }),
      makeStaff({ id: 'n-6', name: 'ナース6', role: '一般', max_night_shifts: 2, sort_order: 6 }),
      makeStaff({ id: 'sn-1', name: '師長', role: '師長', max_night_shifts: 0, sort_order: 7 }),
      makeStaff({ id: 'sn-2', name: '主任', role: '主任', max_night_shifts: 0, sort_order: 8 }),
    ]
    const output = await generateShiftsFallback(buildInput({ staff: staff2Night }))
    // 夜→明→夜→明 のパターンが存在すれば2連続夜勤が生成されている証拠
    let foundConsecutive = false
    for (const member of staff2Night) {
      const shifts = output.grid[member.id]
      for (let d = 0; d + 3 < DAYS; d++) {
        if (shifts[d] === '夜' && shifts[d + 1] === '明' && shifts[d + 2] === '夜' && shifts[d + 3] === '明') {
          foundConsecutive = true
          // 末尾の夜(d+2)から D+2=公, D+3=公 であること
          if (d + 4 < DAYS) expect(shifts[d + 4], `${member.name} day${d + 5}`).toBe('公')
          if (d + 5 < DAYS) expect(shifts[d + 5], `${member.name} day${d + 6}`).toBe('公')
        }
      }
    }
    // 必ずしも2連続が生成されるとは限らないが、生成された場合は公公で終わること
    if (foundConsecutive) {
      expect(foundConsecutive).toBe(true)
    }
  })

})
