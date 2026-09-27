/**
 * Page-delivery facts that decide where the update seat may appear.
 *
 * The family self-update is a *web* surface: it runs pnpm inside the profile
 * the host was booted from, which only makes sense for a page the browser
 * loaded over the network. The official DSH Desktop shell serves its Web GUI
 * from `dsh-app://app/` and the desktop application owns its own updater, so
 * that page must not render the seat — it keeps the phone-remote trigger that
 * shares the same sidebar seat.
 *
 * Naming the web side rather than an allowlist of known shells follows the
 * pairing fence's own classification
 * (`packages/dsh-remote-web-ui/src/remote-channel-rules.ts`, WEB_PAGE_PROTOCOLS):
 * any scheme that is not a web scheme was delivered by an application on this
 * machine. The two lists describe the same fact and stay in step.
 */

/** Schemes a web page can be delivered with. */
export const WEB_PAGE_SCHEMES: readonly string[] = [
  'http:',
  'https:',
  'blob:',
  'data:',
  'about:',
  'filesystem:',
]

/**
 * Whether the page was delivered by an application on this machine (the DSH
 * Desktop shell) instead of a web transport.
 * @param protocol - `location.protocol` of the page (for example `dsh-app:`).
 * @returns true for an application-delivered page; false for a web page and
 *   for an unreadable (empty) scheme, which stays on the web side.
 */
export function isApplicationDeliveredPage(protocol: string): boolean {
  return protocol !== '' && !WEB_PAGE_SCHEMES.includes(protocol)
}

/**
 * Whether the sidebar seat may mount on this page. The desktop shell owns its
 * own updater, so the seat belongs to web pages only.
 * @param protocol - `location.protocol` of the page.
 * @returns true when the update trigger may register.
 */
export function shouldMountUpdateSeat(protocol: string): boolean {
  return !isApplicationDeliveredPage(protocol)
}

/**
 * Read the page protocol from a window-like object.
 * @param win - the window to read (defaults to the real one).
 * @returns `location.protocol`, or an empty string when unreadable.
 */
export function pageProtocolOf(win: { location?: { protocol?: string } } = window): string {
  return win.location?.protocol ?? ''
}
