# Agent Note: the DeepSeek peak rule prices a Chinese public holiday off-peak, so the package carries the holiday table

Status: implemented

## Problem

The reported symptom was an estimate at roughly twice the real price, attributed to a "tiao xiu" (adjusted) workday falling on a weekend. The investigation confirmed a real defect in [the peak-pricing note's clock](../implemented/feature/2026-08-29-usage-peak-pricing-and-announce-fix.md), but the direction of the error is the opposite one: the estimate is too **low** during a public holiday, and weekends were already handled the way the provider bills them.

The official rule ([api-docs.deepseek.com pricing page](https://api-docs.deepseek.com/quick_start/pricing/), footnote 2) reads: peak hours are Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00, **excluding Chinese public holidays**; all other hours are off-peak, **including weekends and Chinese public holidays in full**.

- **A public-holiday date is not derivable from any rule.** The State Council publishes the arrangement per year, so the shipped clock, gating only on `getUTCDay()`, counted every Monday-Friday as peak, including a holiday morning billed at half. That is the half of the report that is real.
- **An adjusted-workday weekend is not a peak day.** The provider counts the calendar day, not the working schedule: a Sunday designated as a workday is still off-peak in full. The existing `weekday >= 1 && weekday <= 5` gate already matches this, and the test that pins it is what stops a future "fix" from re-introducing the reported error in the opposite direction.

## Decision

1. **The rule takes its dates as a `PublicHolidayCalendar`** (`isPublicHoliday(date)` over Beijing-time `YYYY-MM-DD` strings). Both the peak test and the next-boundary scan route through one `isPeakDay()` predicate, so a skipped holiday does not leave a phantom window behind. `YYYY-MM-DD` is the right granularity because a holiday is off-peak for the whole day.
2. **The default calendar is the published table** (`src/core/holidays.ts`), covering 2020 through 2026. The earlier default was empty, which left the defect invisible; with the table in place a holiday weekday prices at the off-peak row with no caller argument and no wiring at the fold site.
3. **Adjusted workdays are deliberately absent from the table.** Only `holiday` entries are taken from the source data. A designated Saturday or Sunday is off-peak by calendar day, so listing it would price it as peak — the exact error this note exists to prevent.
4. **A year the table does not cover prices at peak on weekdays.** The estimate then reads high rather than low, which is the safer direction to be wrong in: it never under-reports spend.

## Data source

The table is generated from the yearly schedules in [bastengao/chinese-holidays-node](https://github.com/bastengao/chinese-holidays-node) (MIT), `data/<year>.json`.

Only the data files are vendored. That package's runtime code fetches over the network and pulls in `request` (deprecated, known vulnerabilities) and `moment`, has no TypeScript types, and `holiday-cn` is a hosted microservice rather than a library — none of them belong in a local cost ledger whose browser bundle is gated for purity. Taking the yearly JSON costs nothing at runtime and keeps the package dependency-free.

Regenerate by re-extracting the `holiday` entries of a new year's `data/<year>.json` into `src/core/holidays.ts` and bumping `HOLIDAY_TABLE_LAST_YEAR`. The test suite fails when coverage is not contiguous, so a forgotten year cannot land silently.

## Context & Efficiency Impact

The calendar is a one-method interface over a static object, so the host half pays one property lookup and one `includes` per fold, and the browser half nothing beyond it. The table is about 5 KB of source. No schema, wire, or prompt cost; the interface is internal to `src/core/`.

## Alternatives considered

- **Treat adjusted workdays as peak days (the report as written).** Rejected on the evidence: the provider bills a designated workday falling on a weekend entirely off-peak. Implementing it would have moved the estimate further from the bill, and it is the harder defect to notice because holidays are rarer than weekends.
- **Hardcode a 2026 (or any single-year) holiday table.** Rejected: it silently rots. A table of contiguous years that fails a coverage test is better than one that looks authoritative while a year behind.
- **Fetch the calendar from a network endpoint at runtime.** Rejected: the browser bundle purity gate rules out arbitrary runtime fetches, and an estimator that silently changes with network availability is not a deterministic cost record.
- **Add a third-party holiday dependency.** Rejected on the evidence rather than on principle: the available packages are the data source itself (fetching, `request`, no types) or a hosted service. Vendoring the data achieves the same result with no runtime dependency.
- **Derive holidays from the lunar calendar.** Rejected: a lunar date maps to a Gregorian holiday only after the State Council's own offset decision, so it is not a rule, it is a second calendar to maintain.

## Verification

`tests/pricing.spec.ts` prices a Monday and a Thursday inside the 2026 National Day holiday at the off-peak row with no calendar argument, prices the same weekday in an ordinary week at the peak row, and pins that a caller-supplied calendar still overrides the table. `tests/holidays.spec.ts` checks the table itself: contiguous coverage from 2020 to `HOLIDAY_TABLE_LAST_YEAR`, no duplicate dates, every date a round-tripping `YYYY-MM-DD`, the absence of an adjusted workday, and a covered year declining rather than erroring.

## Risks

- **The table rots after 2026.** A year past the table prices every weekday at peak, which over-reports spend until the table is extended. This is the intended failure direction, and the coverage test is where to notice it.
- **A wrong table is worse than no table**, because a calendar marking a normal weekday as a holiday under-prices a busy day. Hence the ordinary-week assertions, and the fact that only upstream-published data is taken rather than a hand-edited list.
