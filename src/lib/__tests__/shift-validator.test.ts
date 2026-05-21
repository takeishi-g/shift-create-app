import { describe, it, expect } from 'vitest'
import { validateAndFixPairConstraints } from '../shift-validator'
import type { ShiftGrid } from '../shift-solver'
import type { StaffPairConstraint, StaffProfile } from '@/types'

// ──────────────────────────────────────────────
// フィクスチャ
// ──────────────────────────────────────────────

function makeStaff(id: string): StaffProfile {
  return {
    id,
    name: `スタッフ_${id}`,
    qualification: '正看護師',
    role: '一般',
    work_start_time: '08:30',
    work_end_time: '17:30',
    max_night_shifts: 6,
    experience_years: 3,
    off_days_of_week: [],
    off_on_holidays: false,
    off_days_constraint: 'soft',
    allow_extra_off_days: true,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makePair(overrides: Partial<StaffPairConstraint> = {}): StaffPairConstraint {
  return {
    id: 'pair-1',
    staff_id_a: 'staff-a',
    staff_id_b: 'staff-b',
    constraint_type: 'must_not_pair',
    shift_type_id: null,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const DAYS = 7
const ALL_STAFF = [makeStaff('staff-a'), makeStaff('staff-b'), makeStaff('staff-c'), makeStaff('staff-d')]

function emptyGrid(days = DAYS): ShiftGrid {
  return Object.fromEntries(ALL_STAFF.map((s) => [s.id, Array(days).fill('') as string[]]))
}

// ──────────────────────────────────────────────
// 基本動作
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — 基本動作', () => {
  it('違反がない場合はグリッドを変更しない', () => {
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-c'][0] = '夜'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    expect(grid['staff-a'][0]).toBe('夜')
    expect(grid['staff-c'][0]).toBe('夜')
    expect(warnings).toHaveLength(0)
  })

  it('スタッフが空の場合は何もしない', () => {
    const warnings: string[] = []
    validateAndFixPairConstraints({}, [makePair()], [], warnings)
    expect(warnings).toHaveLength(0)
  })

  it('must_pair 制約はスキップする', () => {
    const mustPair = makePair({ constraint_type: 'must_pair' })
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][1] = '夜'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [mustPair], ALL_STAFF, warnings)

    expect(warnings).toHaveLength(0)
  })

  it('staff_id_a がグリッドに存在しない場合はクラッシュしない', () => {
    const grid = emptyGrid()
    const unknownPair = makePair({ staff_id_a: 'unknown-id' })
    const warnings: string[] = []
    expect(() => validateAndFixPairConstraints(grid, [unknownPair], ALL_STAFF, warnings)).not.toThrow()
  })
})

// ──────────────────────────────────────────────
// 夜勤ペア違反
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — 夜勤ペア違反', () => {
  it('staff-b を解放し代替スタッフを充填する', () => {
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜'
    grid['staff-a'][1] = '明'
    grid['staff-b'][1] = '明'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    expect(grid['staff-a'][0]).toBe('夜')
    expect(grid['staff-b'][0]).toBe('')
    expect(grid['staff-b'][1]).toBe('')
    const refilled = ['staff-c', 'staff-d'].some((id) => grid[id][0] === '夜')
    expect(refilled).toBe(true)
    expect(warnings.some((w) => w.includes('再充填'))).toBe(true)
  })

  it('夜勤解放時に翌々日の公休も解放する', () => {
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜'
    grid['staff-a'][1] = '明'
    grid['staff-b'][1] = '明'
    grid['staff-b'][2] = '公' // 夜勤後の自動挿入

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    expect(grid['staff-b'][0]).toBe('')
    expect(grid['staff-b'][1]).toBe('')
    expect(grid['staff-b'][2]).toBe('') // 公も解放される
  })

  it('代替スタッフが全員不可の場合は空きのまま警告する', () => {
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜'
    grid['staff-a'][1] = '明'
    grid['staff-b'][1] = '明'
    // staff-c, staff-d を dayIdx=0 に埋める（canTakeNight で弾かれる）
    grid['staff-c'][0] = '日'
    grid['staff-d'][0] = '日'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    expect(grid['staff-b'][0]).toBe('')
    expect(warnings.some((w) => w.includes('代替スタッフが見つかりませんでした'))).toBe(true)
  })

  it('月末（最終日）の夜勤違反で翌日チェックが境界外にはみ出さない', () => {
    const days = 3
    const grid: ShiftGrid = Object.fromEntries(
      ALL_STAFF.map((s) => [s.id, Array(days).fill('') as string[]]),
    )
    // 最終日（dayIdx=2）に夜勤ペア違反
    grid['staff-a'][2] = '夜'
    grid['staff-b'][2] = '夜'

    const warnings: string[] = []
    expect(() => validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)).not.toThrow()
    expect(grid['staff-b'][2]).toBe('')
  })

  it('連続勤務上限に達したスタッフは再充填候補にならない', () => {
    // maxConsecutive = 2
    const grid = emptyGrid()
    grid['staff-a'][2] = '夜'
    grid['staff-b'][2] = '夜'
    grid['staff-a'][3] = '明'
    grid['staff-b'][3] = '明'
    // staff-c は dayIdx=1,2 に日勤（連続2日 → dayIdx=2+1=3なので streak=2、maxConsecutive=2）
    // dayIdx=2 の夜勤: streak=1 (dayIdx-1=1 が '日' → isWork → 2) → 2 > 2 → 不可
    grid['staff-c'][0] = '日'
    grid['staff-c'][1] = '日' // streak 2日分

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings, 2)

    // staff-c は連続勤務超過で候補にならない（staff-d が充填されるか、代替なし）
    // staff-d は空きなので充填される
    expect(grid['staff-c'][2]).not.toBe('夜')
  })
})

// ──────────────────────────────────────────────
// 日勤ペア違反
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — 日勤ペア違反', () => {
  it('staff-b を解放し代替スタッフを充填する', () => {
    const grid = emptyGrid()
    grid['staff-a'][2] = '日'
    grid['staff-b'][2] = '日'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    expect(grid['staff-a'][2]).toBe('日')
    expect(grid['staff-b'][2]).toBe('')
    const refilled = ['staff-c', 'staff-d'].some((id) => grid[id][2] === '日')
    expect(refilled).toBe(true)
  })

  it('翌日が夜勤の候補は日勤に充填しない', () => {
    const grid = emptyGrid()
    grid['staff-a'][2] = '日'
    grid['staff-b'][2] = '日'
    // staff-c の dayIdx=3 が '夜' → canTakeDay で dayIdx+1===夜 で弾かれる
    grid['staff-c'][3] = '夜'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    // staff-c は候補にならない
    expect(grid['staff-c'][2]).not.toBe('日')
    // staff-d が充填される
    expect(grid['staff-d'][2]).toBe('日')
  })
})

// ──────────────────────────────────────────────
// シフト種別限定ペア
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — シフト種別限定', () => {
  it('夜勤専用ペア禁止: 夜勤違反を修正し日勤は対象外', () => {
    const nightOnlyPair = makePair({
      shift_type_id: 'night-type',
      shift_type: { id: 'night-type', name: '夜勤', is_overnight: true, is_off: false },
    })
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜' // 夜勤違反 → 修正
    grid['staff-a'][1] = '日'
    grid['staff-b'][1] = '日' // 日勤はスコープ外 → そのまま

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [nightOnlyPair], ALL_STAFF, warnings)

    expect(grid['staff-b'][0]).toBe('')
    expect(grid['staff-a'][1]).toBe('日')
    expect(grid['staff-b'][1]).toBe('日')
  })

  it('日勤専用ペア禁止: 日勤違反を修正し夜勤は対象外', () => {
    const dayOnlyPair = makePair({
      shift_type_id: 'day-type',
      shift_type: { id: 'day-type', name: '日勤', is_overnight: false, is_off: false },
    })
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜' // 夜勤はスコープ外 → そのまま
    grid['staff-a'][2] = '日'
    grid['staff-b'][2] = '日' // 日勤違反 → 修正

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [dayOnlyPair], ALL_STAFF, warnings)

    expect(grid['staff-a'][0]).toBe('夜')
    expect(grid['staff-b'][0]).toBe('夜')
    expect(grid['staff-b'][2]).toBe('')
  })
})

// ──────────────────────────────────────────────
// 複数ペア制約の相互作用（収束ループ）
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — 複数ペア制約', () => {
  it('A-B と A-C の両方が must_not_pair: 同日全員夜勤で両方の違反を解消する', () => {
    const pairAB = makePair({ id: 'pair-ab', staff_id_a: 'staff-a', staff_id_b: 'staff-b' })
    const pairAC = makePair({ id: 'pair-ac', staff_id_a: 'staff-a', staff_id_b: 'staff-c' })
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜'
    grid['staff-c'][0] = '夜'
    // staff-d は空き → 代替候補

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [pairAB, pairAC], ALL_STAFF, warnings)

    // staff-a はそのまま
    expect(grid['staff-a'][0]).toBe('夜')
    // staff-b と staff-c のうち少なくとも一方は解放されている
    const bFixed = grid['staff-b'][0] === ''
    const cFixed = grid['staff-c'][0] === ''
    // 両方が staff-a と同日夜勤にはなっていない
    const aViolation = (grid['staff-b'][0] === '夜' || grid['staff-c'][0] === '夜') &&
      grid['staff-a'][0] === '夜'
    // ペア制約 A-B と A-C が両方満たされていること
    const abViolation = grid['staff-a'][0] === '夜' && grid['staff-b'][0] === '夜'
    const acViolation = grid['staff-a'][0] === '夜' && grid['staff-c'][0] === '夜'
    expect(abViolation).toBe(false)
    expect(acViolation).toBe(false)
    void bFixed; void cFixed; void aViolation // suppress lint
  })

  it('A-B と B-C の両方が must_not_pair: 同日全員夜勤でいずれも違反なし', () => {
    const pairAB = makePair({ id: 'pair-ab', staff_id_a: 'staff-a', staff_id_b: 'staff-b' })
    const pairBC = makePair({ id: 'pair-bc', staff_id_a: 'staff-b', staff_id_b: 'staff-c' })
    const grid = emptyGrid()
    grid['staff-a'][0] = '夜'
    grid['staff-b'][0] = '夜'
    grid['staff-c'][0] = '夜'

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [pairAB, pairBC], ALL_STAFF, warnings)

    // 処理後に A-B, B-C のどちらも夜勤ペアでないこと
    const nightSet = new Set(
      ALL_STAFF.filter((s) => grid[s.id][0] === '夜').map((s) => s.id),
    )
    expect(nightSet.has('staff-a') && nightSet.has('staff-b')).toBe(false)
    expect(nightSet.has('staff-b') && nightSet.has('staff-c')).toBe(false)
  })

  it('独立した2ペアが同日に別々の違反を起こす場合も両方修正する', () => {
    // A-B と C-D が別々のペア制約
    const pairAB = makePair({ id: 'pair-ab', staff_id_a: 'staff-a', staff_id_b: 'staff-b' })
    const pairCD: StaffPairConstraint = {
      id: 'pair-cd',
      staff_id_a: 'staff-c',
      staff_id_b: 'staff-d',
      constraint_type: 'must_not_pair',
      shift_type_id: null,
      note: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    // 5人目のスタッフが必要（代替候補）
    const extraStaff = [...ALL_STAFF, makeStaff('staff-e')]
    const grid: ShiftGrid = Object.fromEntries(
      extraStaff.map((s) => [s.id, Array(DAYS).fill('') as string[]]),
    )
    grid['staff-a'][1] = '夜'
    grid['staff-b'][1] = '夜' // A-B 違反
    grid['staff-c'][1] = '夜'
    grid['staff-d'][1] = '夜' // C-D 違反

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [pairAB, pairCD], extraStaff, warnings)

    // 両違反が解消されていること
    expect(grid['staff-a'][1] === '夜' && grid['staff-b'][1] === '夜').toBe(false)
    expect(grid['staff-c'][1] === '夜' && grid['staff-d'][1] === '夜').toBe(false)
  })
})

// ──────────────────────────────────────────────
// isWork が '明' を含むことの保証（連続勤務チェック）
// ──────────────────────────────────────────────

describe('validateAndFixPairConstraints — 連続勤務チェック（明を含む）', () => {
  it('夜→明→日→日 の後に再充填される候補として選ばれない（maxConsecutive=4）', () => {
    // grid: [夜, 明, 日, 日, 違反日, ...]
    // staff-c が dayIdx=0〜3 に連続4日（夜/明/日/日）で maxConsecutive=4 の場合、
    // dayIdx=4 には充填できない
    const days = 7
    const grid: ShiftGrid = Object.fromEntries(
      ALL_STAFF.map((s) => [s.id, Array(days).fill('') as string[]]),
    )
    grid['staff-a'][4] = '夜'
    grid['staff-b'][4] = '夜' // 違反

    // staff-c が 0〜3 に連続4日（夜明日日）
    grid['staff-c'][0] = '夜'
    grid['staff-c'][1] = '明'
    grid['staff-c'][2] = '日'
    grid['staff-c'][3] = '日'
    // dayIdx=4 に夜勤を入れると streak が 1（=1）... しかし '明' を isWork に含めると
    // i=3:'日'→2, i=2:'日'→3, i=1:'明'→4, i=0:'夜'→5 → 5 > 4 → false

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings, 4)

    // staff-c は連続勤務超過で候補にならない
    expect(grid['staff-c'][4]).not.toBe('夜')
    // staff-d が充填される
    expect(grid['staff-d'][4]).toBe('夜')
  })

  it('夜→明 の翌日に再充填されない（前日が明けで即 L17 の前日チェックが弾く）', () => {
    // [夜, 明, ''] の dayIdx=2: L17 で dayIdx-1='明' → false のため夜勤不可
    const days = 5
    const grid: ShiftGrid = Object.fromEntries(
      ALL_STAFF.map((s) => [s.id, Array(days).fill('') as string[]]),
    )
    grid['staff-a'][2] = '夜'
    grid['staff-b'][2] = '夜' // 違反

    // staff-c の dayIdx=1 が '明'（前日が '夜'）
    grid['staff-c'][0] = '夜'
    grid['staff-c'][1] = '明'
    // dayIdx=2 は '': canTakeNight で dayIdx-1='明' → false

    const warnings: string[] = []
    validateAndFixPairConstraints(grid, [makePair()], ALL_STAFF, warnings)

    // staff-c は候補にならない（dayIdx-1 が '明'）
    expect(grid['staff-c'][2]).not.toBe('夜')
    // staff-d が充填される
    expect(grid['staff-d'][2]).toBe('夜')
  })
})
