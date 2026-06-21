/**
 * 夜勤回数が多いスタッフの「2連続夜勤（夜→明→夜→明→公→公）」を促す報酬のリグレッションテスト
 *
 * 背景（docs/CONSTRAINTS.md §4「夜勤回数が多いスタッフのパターン」）:
 *   max_night_shifts > 5 のスタッフは、夜勤どうしを2連続にして夜勤明けの休みを2連休にするのが望ましい。
 *   いったん 2連続夜勤 n[D]=n[D+2]=1 が立てば、既存の安全制約
 *   （ake_origin / post_night_off / max2_consecutive_night / double_night_second_off）が
 *   「夜(D)→明(D+1)→夜(D+2)→明(D+3)→公(D+4)→公(D+5)」を自動的に確定する。
 *
 * 不具合（修正前）:
 *   高夜勤スタッフ専用ブロックに「2連続夜勤へのペナルティ(+4)」があり、夜勤が全て単発（夜→明→公）になり
 *   ダブルが0本だった。これを「2連続夜勤への報酬(係数 -3)」に反転した。
 *
 * 本テストは max_night=8 の一般スタッフを複数置いて生成し、ダブル（夜明夜明）が一定数以上発生し、
 * その直後が2連休（公公）になり、夜勤明けの安全ルール（夜→明・3連続禁止）も守られることを検証する。
 * 旧ペナルティ版では doubles=0 になり、ダブル本数のアサーションで fail する。
 *
 * 月末境界の注記: 月末ダブル（D+2 が月内だが D+4/D+5 が月外）は報酬対象になりうるが、2連休後半の
 * 公休(D+5)は当月では強制されず翌月生成の prevMonthTail 処理に委ねられる。よって2連休アサートは
 * `d+4 < DAYS` / `d+5 < DAYS` のときのみ行う（当月で保証される範囲に限定）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { generateShifts, SolverInput, SolverOutput } from '../shift-solver-csp'
import { ShiftConstraints, StaffProfile } from '@/types'

const DAYS = 31 // 2026-08

function makeStaff(
  o: Partial<StaffProfile> & Pick<StaffProfile, 'id' | 'name' | 'role' | 'sort_order'>,
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
    ...o,
  }
}

// シニア2名（夜勤少）＋ 一般8名（max_night=8 ＝ 高夜勤ブロック対象）
const SENIOR_IDS = ['sn-1', 'sn-2']
const HIGH_NIGHT_IDS = Array.from({ length: 8 }, (_, i) => `g-${i + 1}`)

const STAFF: StaffProfile[] = [
  makeStaff({ id: 'sn-1', name: '師長', role: '師長', sort_order: 1, max_night_shifts: 2 }),
  makeStaff({ id: 'sn-2', name: '主任', role: '主任', sort_order: 2, max_night_shifts: 4 }),
  ...HIGH_NIGHT_IDS.map((id, i) =>
    makeStaff({ id, name: `一般${i + 1}`, role: '一般', sort_order: i + 3, max_night_shifts: 8 }),
  ),
]

const CONSTRAINTS: ShiftConstraints = {
  id: 'test',
  year_month: '2026-08',
  min_staff_per_shift: { 日勤: 3, 夜勤: 2 },
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

function buildInput(): SolverInput {
  return {
    yearMonth: '2026-08',
    staff: STAFF,
    constraints: CONSTRAINTS,
    leaveRequests: [],
    pairConstraints: [],
    bathDayIndices: [],
    prevMonthTail: [],
  }
}

// row の中で「夜明夜明」が始まるインデックス（2連続夜勤の起点）を列挙
function doubleStarts(row: string[]): number[] {
  const starts: number[] = []
  for (let d = 0; d + 3 < DAYS; d++) {
    if (row[d] === '夜' && row[d + 1] === '明' && row[d + 2] === '夜' && row[d + 3] === '明') {
      starts.push(d)
    }
  }
  return starts
}

describe('高夜勤スタッフは2連続夜勤＋2連休が促される（報酬・CONSTRAINTS.md §4）', () => {
  let out: SolverOutput

  beforeAll(async () => {
    out = await generateShifts(buildInput())
  }, 120_000)

  it('解が得られる（success）', () => {
    expect(out.solverStatus).toBe('success')
  })

  it('高夜勤スタッフ全体で2連続夜勤（夜明夜明）が複数発生する', () => {
    const total = HIGH_NIGHT_IDS.reduce((sum, id) => sum + doubleStarts(out.grid[id]).length, 0)
    // 8人 × 夜勤約7回 → ゾーン制約内でも各人2本前後のダブルが期待できる。
    // 旧ペナルティ版では total===0 になり、ここで fail する。閾値は実測に基づく安全側。
    expect(total).toBeGreaterThanOrEqual(8)
  })

  it('各2連続夜勤の直後は2連休（公公）になる', () => {
    for (const id of HIGH_NIGHT_IDS) {
      const row = out.grid[id]
      for (const d of doubleStarts(row)) {
        // 夜(d)→明(d+1)→夜(d+2)→明(d+3)→公(d+4)→公(d+5)
        if (d + 4 < DAYS) {
          expect(row[d + 4], `${id}: ダブル起点${d} の +4 が公でない`).toBe('公')
        }
        if (d + 5 < DAYS) {
          expect(row[d + 5], `${id}: ダブル起点${d} の +5 が公でない`).toBe('公')
        }
      }
    }
  })

  it('夜勤の翌日は必ず明（安全ルール回帰）', () => {
    for (const id of [...SENIOR_IDS, ...HIGH_NIGHT_IDS]) {
      const row = out.grid[id]
      for (let d = 0; d + 1 < DAYS; d++) {
        if (row[d] === '夜') {
          expect(row[d + 1], `${id}: 夜勤${d} の翌日が明でない`).toBe('明')
        }
      }
    }
  })

  it('3連続夜勤（夜明夜明夜）は発生しない', () => {
    for (const id of [...SENIOR_IDS, ...HIGH_NIGHT_IDS]) {
      const row = out.grid[id]
      for (let d = 0; d + 4 < DAYS; d++) {
        const triple = row[d] === '夜' && row[d + 2] === '夜' && row[d + 4] === '夜'
        expect(triple, `${id}: idx${d} から3連続夜勤`).toBe(false)
      }
    }
  })

  it('夜勤の少ないスタッフ（max_night<=5）にはダブル報酬が付かない（>5 ゲートの確認）', () => {
    // sn-1(max2)・sn-2(max4) は報酬ブロック対象外かつ night_spacing(minGap>=6)で
    // 夜勤が2日間隔に並ばないため、ダブル（夜明夜明）は構造的に発生しえない。
    for (const id of SENIOR_IDS) {
      expect(doubleStarts(out.grid[id]).length, `${id}: 低夜勤スタッフにダブルが発生`).toBe(0)
    }
  })

  it('高夜勤スタッフは夜勤が十分入る（高夜勤として機能）', () => {
    for (const id of HIGH_NIGHT_IDS) {
      const nights = out.grid[id].filter((c) => c === '夜').length
      // 月62コマ(2×31)を主に8人で負担 → 1人あたり概ね5〜8回。
      expect(nights, `${id}: 夜勤数 ${nights}`).toBeGreaterThanOrEqual(5)
    }
  })
})
