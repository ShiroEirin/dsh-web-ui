import { describe, expect, it } from 'vitest'
import type { PublicHolidayCalendar } from '../src/core/pricing.ts'
import { deepseekModelSpend, deepseekPeriodAt } from '../src/core/pricing.ts'
import { emptyTotals } from '../src/core/types.ts'

/**
 * Fixed instants picked against the published window definition (Beijing
 * Monday-Friday 09:00-12:00 and 14:00-18:00). 2026-08-28 is a Friday,
 * 2026-08-29 a Saturday, 2026-08-31 a Monday; Beijing = UTC+8 year-round.
 */
const FRI_10_00_BJ = Date.UTC(2026, 7, 28, 2, 0) // Friday 10:00 Beijing -> peak
const FRI_12_30_BJ = Date.UTC(2026, 7, 28, 4, 30) // Friday 12:30 Beijing -> off-peak
const FRI_13_00_BJ = Date.UTC(2026, 7, 28, 5, 0) // Friday 13:00 Beijing -> off-peak
const FRI_20_00_BJ = Date.UTC(2026, 7, 28, 12, 0) // Friday 20:00 Beijing -> off-peak
const SAT_10_00_BJ = Date.UTC(2026, 7, 29, 2, 0) // Saturday -> off-peak
const MON_09_00_BJ = Date.UTC(2026, 7, 31, 1, 0) // Monday 09:00 Beijing -> peak start
// Two real dates from the shipped 2026 table (National Day runs 2026-10-01 to
// 2026-10-07), which makes them the strongest check that the default calendar
// is the published one and not an empty stub: a Thursday and a Monday inside a
// holiday both bill off-peak with no argument at all.
const HOLIDAY_THU_10_00_BJ = Date.UTC(2026, 9, 1, 2, 0) // Thursday inside a public holiday -> off-peak
const HOLIDAY_MON_10_00_BJ = Date.UTC(2026, 9, 5, 2, 0) // Monday inside a public holiday -> off-peak

const PUBLIC_HOLIDAYS: PublicHolidayCalendar = {
  isPublicHoliday: (date) => date === '2026-10-01' || date === '2026-10-05',
}

describe('deepseekPeriodAt', () => {
  it('flags the morning and afternoon weekday windows as peak, ending at the window close', () => {
    expect(deepseekPeriodAt(FRI_10_00_BJ)).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 4, 0) })
    expect(deepseekPeriodAt(Date.UTC(2026, 7, 28, 7, 30))).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 10, 0) })
  })

  it('treats the lunch gap, evening, and weekends as off-peak', () => {
    expect(deepseekPeriodAt(FRI_12_30_BJ).peak).toBe(false)
    expect(deepseekPeriodAt(FRI_13_00_BJ)).toEqual({ peak: false, boundaryMs: Date.UTC(2026, 7, 28, 6, 0) })
    expect(deepseekPeriodAt(FRI_20_00_BJ).peak).toBe(false)
    expect(deepseekPeriodAt(SAT_10_00_BJ).peak).toBe(false)
  })

  it('points the next boundary at the next window start across the weekend', () => {
    expect(deepseekPeriodAt(FRI_20_00_BJ).boundaryMs).toBe(MON_09_00_BJ)
    expect(deepseekPeriodAt(SAT_10_00_BJ).boundaryMs).toBe(MON_09_00_BJ)
    // Friday 08:30 Beijing: same-morning window start.
    expect(deepseekPeriodAt(Date.UTC(2026, 7, 28, 0, 30))).toEqual({ peak: false, boundaryMs: Date.UTC(2026, 7, 28, 1, 0) })
    // Monday 09:00 sharp opens the peak.
    expect(deepseekPeriodAt(MON_09_00_BJ).peak).toBe(true)
  })

  it('lands the peak boundary exactly on the closing minute, sub-second precision included', () => {
    const almostNoon = Date.UTC(2026, 7, 28, 3, 59, 59, 500)
    expect(deepseekPeriodAt(almostNoon)).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 4, 0, 0, 0) })
  })

  it('operator gets a holiday weekday at off-peak from the shipped table, with no calendar argument', () => {
    // Given no calendar at all, so the published table is in force
    // When the billing period is read inside the morning window
    // Then both holiday weekdays read off-peak rather than peak, which is the
    // half of the published rule that defaults to over-reporting when missed
    expect(deepseekPeriodAt(HOLIDAY_MON_10_00_BJ).peak).toBe(false)
    expect(deepseekPeriodAt(HOLIDAY_THU_10_00_BJ).peak).toBe(false)
    // And a caller-supplied calendar still overrides the table
    expect(deepseekPeriodAt(HOLIDAY_MON_10_00_BJ, PUBLIC_HOLIDAYS).peak).toBe(false)
  })

  it('operator keeps a holiday weekday on peak when a caller supplies a calendar that omits it', () => {
    // Given a calendar that knows only National Day itself
    // When the Monday after it is read inside the morning window
    // Then the caller's table wins over the shipped one, so the default stays
    // overridable rather than baked in
    const onlyNationalDay: PublicHolidayCalendar = { isPublicHoliday: date => date === '2026-10-01' }
    expect(deepseekPeriodAt(HOLIDAY_MON_10_00_BJ, onlyNationalDay).peak).toBe(true)
  })

  it('operator is pointed at the next weekday morning when a holiday closes the day', () => {
    // Given a calendar marking Monday 2026-10-05 as a public holiday
    // When the next boundary is read from the holiday morning
    // Then it skips both the holiday afternoon and the weekend to Tuesday 09:00
    expect(deepseekPeriodAt(HOLIDAY_MON_10_00_BJ, PUBLIC_HOLIDAYS).boundaryMs).toBe(Date.UTC(2026, 9, 6, 1, 0))
    // And the same calendar pushes a Friday evening across the holiday weekend
    expect(deepseekPeriodAt(Date.UTC(2026, 9, 2, 12, 0), PUBLIC_HOLIDAYS).boundaryMs).toBe(Date.UTC(2026, 9, 6, 1, 0))
  })

  it('operator sees days outside the calendar priced unchanged by a partial calendar', () => {
    // Given a calendar that knows only 2026-10-01
    // When an ordinary August week is priced
    // Then its peak window and next Monday boundary are exactly as before
    const onlyNationalDay: PublicHolidayCalendar = { isPublicHoliday: (date) => date === '2026-10-01' }
    expect(deepseekPeriodAt(FRI_10_00_BJ, onlyNationalDay)).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 4, 0) })
    expect(deepseekPeriodAt(FRI_20_00_BJ, onlyNationalDay).boundaryMs).toBe(MON_09_00_BJ)
  })
})

describe('deepseekModelSpend with a public-holiday calendar', () => {
  it('prices uncached input, cache hits, and output at the published per-million rows', () => {
    // flash off-peak: miss 1, hit 0.02, output 4 per million.
    expect(deepseekModelSpend('deepseek-flash', { ...emptyTotals(), inputTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(1, 6)
    expect(deepseekModelSpend('deepseek-flash', { ...emptyTotals(), cacheReadTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(0.02, 6)
    expect(deepseekModelSpend('deepseek-flash', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(4, 6)
  })

  it('doubles every row during the peak period and halves it off-peak', () => {
    const totals = { ...emptyTotals(), inputTokens: 100_000, cacheReadTokens: 200_000, outputTokens: 50_000 }
    const offPeak = (100_000 * 1 + 200_000 * 0.02 + 50_000 * 4) / 1_000_000
    expect(deepseekModelSpend('deepseek-flash', totals, FRI_12_30_BJ)).toBeCloseTo(offPeak, 6)
    expect(deepseekModelSpend('deepseek-flash', totals, FRI_10_00_BJ)).toBeCloseTo(offPeak * 2, 6)
    // The retired flash-class ids are served by V4.1-Flash and bill the same row.
    expect(deepseekModelSpend('deepseek-v4-flash-vision-exp', totals, FRI_12_30_BJ)).toBeCloseTo(offPeak, 6)
    expect(deepseekModelSpend('deepseek-v4-flash', totals, FRI_12_30_BJ)).toBeCloseTo(offPeak, 6)
  })

  it('uses the pro row for v4-pro ids and prices cache writes as uncached input', () => {
    expect(deepseekModelSpend('deepseek-v4-pro', { ...emptyTotals(), inputTokens: 1_000_000 }, FRI_10_00_BJ)).toBeCloseTo(9.0, 6)
    expect(deepseekModelSpend('deepseek-v4-pro', { ...emptyTotals(), cacheWriteTokens: 1_000_000 }, FRI_10_00_BJ)).toBeCloseTo(9.0, 6)
  })

  it('bills a v4-pro id at the flash row from the 2026-09-14 12:00 Beijing routing instant', () => {
    const millionInput = { ...emptyTotals(), inputTokens: 1_000_000 }
    // Sunday 20:00 Beijing (off-peak): the pro row still applies.
    expect(deepseekModelSpend('deepseek-v4-pro', millionInput, Date.UTC(2026, 8, 13, 12, 0))).toBeCloseTo(4.5, 6)
    // The fence lands on the instant: Monday 11:59:59 Beijing is still pro (and peaking)...
    expect(deepseekModelSpend('deepseek-v4-pro', millionInput, Date.UTC(2026, 8, 14, 3, 59, 59))).toBeCloseTo(9.0, 6)
    // ...while Monday 12:00 Beijing already bills the flash row off-peak.
    expect(deepseekModelSpend('deepseek-v4-pro', millionInput, Date.UTC(2026, 8, 14, 4, 0))).toBeCloseTo(1, 6)
    // Monday 20:00 Beijing (also off-peak) stays on the flash row.
    expect(deepseekModelSpend('deepseek-v4-pro', millionInput, Date.UTC(2026, 8, 14, 12, 0))).toBeCloseTo(1, 6)
  })

  it('falls back to the flash-class row for unknown model ids', () => {
    expect(deepseekModelSpend('deepseek-chat', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ))
      .toBe(deepseekModelSpend('deepseek-flash', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ))
  })

  it('operator stops over-reporting a holiday weekday at twice the real cost', () => {
    // Given one million input tokens on a Monday inside the National Day holiday
    // When the flash spend is estimated with no calendar argument
    // Then the shipped table bills the off-peak row, the amount actually charged
    const millionInput = { ...emptyTotals(), inputTokens: 1_000_000 }
    expect(deepseekModelSpend('deepseek-flash', millionInput, HOLIDAY_MON_10_00_BJ)).toBeCloseTo(1, 6)
    // And the same Monday in an ordinary week still bills the peak row
    expect(deepseekModelSpend('deepseek-flash', millionInput, MON_09_00_BJ + 3_600_000)).toBeCloseTo(2, 6)
  })

  it('operator is charged off-peak on a weekend designated as a workday', () => {
    // Given a Sunday that the 2026 arrangement designated as a working day
    // When the period and the flash spend are read there
    // Then both are off-peak, which is what the provider bills
    const adjustedSunday = Date.UTC(2026, 8, 20, 2, 0)
    const onlyNationalDay: PublicHolidayCalendar = { isPublicHoliday: (date) => date === '2026-10-01' }
    expect(deepseekPeriodAt(adjustedSunday, onlyNationalDay).peak).toBe(false)
    expect(deepseekModelSpend('deepseek-flash', { ...emptyTotals(), inputTokens: 1_000_000 }, adjustedSunday, onlyNationalDay)).toBeCloseTo(1, 6)
  })
})
