/**
 * Timestamp rendering for the provider's browser half.
 *
 * The provider formats remote stamps itself: the board's own formatter lives in
 * the board package, which this bundle may not import. The instant is shown in
 * the browser's own time zone, which is the documented consequence of the
 * provider seat contract taking no board formatter.
 *
 * @module dsh-task-board-github/client/format-host-time
 */

const FORMATS = new Map<string, Intl.DateTimeFormat>()

function formatFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  const cached = FORMATS.get(key)
  if (cached !== undefined) return cached
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    ...(timeZone === undefined ? {} : { timeZone }),
  })
  FORMATS.set(key, format)
  return format
}

/**
 * Render one instant for display.
 * @param ms - milliseconds since the epoch.
 * @param timeZone - optional IANA zone; absent uses the browser's zone.
 * @returns the localized stamp, or the ISO instant when the zone is unusable.
 */
export function formatHostTimestamp(ms: number, timeZone?: string): string {
  try {
    return formatFor(timeZone).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}
