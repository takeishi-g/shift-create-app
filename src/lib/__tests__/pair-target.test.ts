import { describe, it, expect } from 'vitest'
import { pairTargetsNight, pairTargetsDay } from '../shift-solver-csp'
import type { StaffPairConstraint } from '@/types'

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

describe('pairTargetsNight', () => {
  it('shift_type_id が null のとき true（全シフト対象）', () => {
    expect(pairTargetsNight(makePair({ shift_type_id: null }))).toBe(true)
  })

  it('is_overnight = true のとき true（夜勤専用制約）', () => {
    expect(
      pairTargetsNight(
        makePair({
          shift_type_id: 'night-type-id',
          shift_type: { id: 'night-type-id', name: '夜勤', is_overnight: true, is_off: false },
        }),
      ),
    ).toBe(true)
  })

  it('is_overnight = false のとき false（日勤専用制約は夜勤に影響しない）', () => {
    expect(
      pairTargetsNight(
        makePair({
          shift_type_id: 'day-type-id',
          shift_type: { id: 'day-type-id', name: '日勤', is_overnight: false, is_off: false },
        }),
      ),
    ).toBe(false)
  })

  it('shift_type_id が非 null で shift_type が未定義のとき false（型情報なし）', () => {
    expect(pairTargetsNight(makePair({ shift_type_id: 'some-id', shift_type: undefined }))).toBe(false)
  })
})

describe('pairTargetsDay', () => {
  it('shift_type_id が null のとき true（全シフト対象）', () => {
    expect(pairTargetsDay(makePair({ shift_type_id: null }))).toBe(true)
  })

  it('is_overnight = false のとき true（日勤専用制約）', () => {
    expect(
      pairTargetsDay(
        makePair({
          shift_type_id: 'day-type-id',
          shift_type: { id: 'day-type-id', name: '日勤', is_overnight: false, is_off: false },
        }),
      ),
    ).toBe(true)
  })

  it('is_overnight = true のとき false（夜勤専用制約は日勤に影響しない）', () => {
    expect(
      pairTargetsDay(
        makePair({
          shift_type_id: 'night-type-id',
          shift_type: { id: 'night-type-id', name: '夜勤', is_overnight: true, is_off: false },
        }),
      ),
    ).toBe(false)
  })

  it('shift_type_id が非 null で shift_type が未定義のとき false（型情報なし）', () => {
    expect(pairTargetsDay(makePair({ shift_type_id: 'some-id', shift_type: undefined }))).toBe(false)
  })
})
