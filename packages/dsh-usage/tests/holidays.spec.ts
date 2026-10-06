import { describe, expect, it } from 'vitest'
import { CHINESE_PUBLIC_HOLIDAYS, HOLIDAY_TABLE_LAST_YEAR } from '../src/core/holidays.ts'
import { CN_PUBLIC_HOLIDAYS } from '../src/core/pricing.ts'

describe('the published Chinese public-holiday table', () => {
  it('operator reads a table whose coverage is contiguous and free of duplicate dates', () => {
    // Given every year the table ships
    const years = Object.keys(CHINESE_PUBLIC_HOLIDAYS).map(Number).sort((a, b) => a - b)

    // When the coverage is read as a range
    // Then it is contiguous from 2020 to the declared last year, so no year
    // silently falls back to pricing every weekday as peak
    expect(years[0]).toBe(2020)
    expect(years[years.length - 1]).toBe(HOLIDAY_TABLE_LAST_YEAR)
    expect(years).toEqual(Array.from({ length: HOLIDAY_TABLE_LAST_YEAR - 2019 }, (_, i) => 2020 + i))

    // And no year repeats a date, which would make the table ambiguous
    for (const year of years) {
      expect(new Set(CHINESE_PUBLIC_HOLIDAYS[String(year)]).size).toBe(CHINESE_PUBLIC_HOLIDAYS[String(year)]!.length)
    }
  })

  it('operator looks up a date that every entry round-trips as a real calendar day', () => {
    // Given every date in the table
    const all = Object.values(CHINESE_PUBLIC_HOLIDAYS).flat()

    // When each one is parsed as a calendar day
    // Then it is a real YYYY-MM-DD date that round-trips, so no lookup can
    // miss on a typo or a padded field
    expect(all.length).toBeGreaterThan(0)
    for (const date of all) {
      expect(date).toMatch(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/)
      expect(new Date(date + 'T00:00:00Z').toISOString().slice(0, 10)).toBe(date)
    }
  })

  it('operator gets a designated Saturday answered off-peak, because the provider counts the calendar day', () => {
    // Given the 2026 arrangement, which designates 2026-10-10 a Saturday working day
    // When the table is asked about it
    // Then it is absent: the rule bills a weekend off-peak in full regardless
    // of the working schedule, and listing it would price it as peak
    expect(CN_PUBLIC_HOLIDAYS.isPublicHoliday('2026-10-10')).toBe(false)
    // And a day the table does cover answers the opposite way
    expect(CN_PUBLIC_HOLIDAYS.isPublicHoliday('2026-10-01')).toBe(true)
  })

  it('operator prices an uncovered year as an ordinary weekday rather than failing', () => {
    // Given a year beyond the table
    // When the calendar is asked about an ordinary Monday in it
    // Then it declines the day, so the estimate stays on the published
    // windows instead of erroring on a missing year
    expect(CN_PUBLIC_HOLIDAYS.isPublicHoliday('2027-06-07')).toBe(false)
  })
})
