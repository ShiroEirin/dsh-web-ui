/**
 * Shared scheduling helpers for the board's schedule editors (the new-task
 * dialog and the task detail panel): the time-zone picker inventory, the
 * relative next-run wording, and the combined absolute + relative label.
 *
 * Everything here is browser-side presentation built on the same pure engine
 * the Host schedules with (`core/schedule.ts`), so the preview a user sees is
 * computed by the code that will actually arm the rule.
 */
import { isValidTimeZone } from '../core/schedule.ts'
import { t } from './locales.ts'

/** One selectable zone, in the order the picker shows it. */
export interface ZoneChoice {
  /** Canonical IANA id, or `''` for the Host-zone entry. */
  id: string
  /** Display label. */
  label: string
}

/**
 * The runtime's zone inventory, read once. `Intl.supportedValuesOf` is not
 * available in every engine, so a missing inventory degrades to `UTC` rather
 * than offering a list that cannot resolve.
 *
 * The inventory is deliberately NOT truncated. A capped list silently omits
 * whole regions, and because a `<select>` whose value matches no option falls
 * back to its first option, an omitted zone would make the control show — and
 * then save — a different zone than the rule actually stores.
 */
let inventoryCache: readonly string[] | undefined

function zoneInventory(): readonly string[] {
  if (inventoryCache !== undefined) return inventoryCache
  let inventory: readonly string[] = []
  try {
    inventory = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  } catch {
    inventory = []
  }
  inventoryCache = inventory.length > 0 ? inventory : ['UTC']
  return inventoryCache
}

/**
 * Zones offered by the picker: the Host zone first (the default, and the entry
 * a rule with no stored zone follows), then the runtime's own inventory.
 *
 * The Host entry is always present, even before the Host snapshot reports a
 * zone: it is the entry that stores no zone, so dropping it would leave a rule
 * unable to express "follow the Host" and would let the control silently
 * display an unrelated zone.
 *
 * A stored zone the inventory does not list (a rule written on another machine
 * or under a different ICU build) is appended, so opening the editor can never
 * silently rewrite the rule's zone.
 * @param hostTimeZone - zone the Host reported for this deployment, when known.
 * @param storedTimeZone - zone the edited rule already stores, when any.
 * @returns the de-duplicated choice list.
 */
export function zoneChoices(hostTimeZone: string | undefined, storedTimeZone?: string): ZoneChoice[] {
  const host = hostTimeZone !== undefined && isValidTimeZone(hostTimeZone) ? hostTimeZone : undefined
  const choices: ZoneChoice[] = []
  const seen = new Set<string>()
  choices.push({
    id: '',
    label: host === undefined
      ? t('detail.schedule.timeZoneHostUnknown')
      : t('detail.schedule.timeZoneHost', { timeZone: host }),
  })
  if (host !== undefined) seen.add(host)
  for (const zone of zoneInventory()) {
    if (seen.has(zone) || !isValidTimeZone(zone)) continue
    seen.add(zone)
    choices.push({ id: zone, label: zone })
  }
  if (storedTimeZone !== undefined && !seen.has(storedTimeZone) && isValidTimeZone(storedTimeZone)) {
    choices.push({ id: storedTimeZone, label: storedTimeZone })
  }
  return choices
}

/** Compact duration parts, largest unit first, with at most two units kept. */
function durationParts(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (days > 0) parts.push(t('detail.schedule.duration.days', { count: String(days) }))
  if (hours > 0) parts.push(t('detail.schedule.duration.hours', { count: String(hours) }))
  if (minutes > 0) parts.push(t('detail.schedule.duration.minutes', { count: String(minutes) }))
  if (parts.length < 2 && (seconds > 0 || parts.length === 0)) {
    parts.push(t('detail.schedule.duration.seconds', { count: String(seconds) }))
  }
  return parts.slice(0, 2).join(' ')
}

/**
 * The relative half of a next-run label: how far away the instant is, or how
 * far past it the board is running. `now` is passed in rather than sampled so
 * callers can share one clock reading across a row, and tests stay
 * deterministic.
 * @param targetMs - the instant being described.
 * @param now - the reference instant.
 * @returns localized relative wording.
 */
export function relativeTimeLabel(targetMs: number, now: number): string {
  const delta = targetMs - now
  if (delta < 0) return t('detail.schedule.nextRunOverdue', { duration: durationParts(-delta) })
  return `${durationParts(delta)}`
}

/**
 * The full next-run label: the absolute wall clock in the schedule's own zone,
 * plus the relative distance in parentheses. Showing both matters because a
 * rule's zone can differ from the reader's, so the wall clock alone is
 * ambiguous and the distance alone loses the actual moment.
 * @param targetMs - the instant being described.
 * @param timeZone - zone to render the absolute half in.
 * @param formatAbsolute - formatter for the absolute half (keeps Intl caching in the caller).
 * @param now - the reference instant.
 * @param translate - translate function, bound so this module stays dependency-light.
 * @returns the combined label.
 */
export function nextRunLabel(
  targetMs: number,
  timeZone: string | undefined,
  formatAbsolute: (ms: number, timeZone?: string) => string,
  now: number,
): string {
  const absolute = formatAbsolute(targetMs, timeZone)
  return `${absolute} (${relativeTimeLabel(targetMs, now)})`
}
