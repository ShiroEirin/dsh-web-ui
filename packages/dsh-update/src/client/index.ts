/**
 * dsh-update — browser half. Registers the `update` dictionaries and the
 * sidebar-foot updater trigger (into the ui-sidebar-declared
 * `sidebar.footer.action` list slot) that opens the update panel.
 *
 * The seat belongs to this package's own plugin row, so disabling
 * dsh-remote-web-ui — or turning its remote access off — leaves the update
 * trigger mounted. The panel talks to this package's own host routes over
 * relative same-origin /api paths. On the desktop shell (an
 * application-delivered page) no seat is mounted at all: that application
 * owns its own updater, and its sidebar seat keeps only the phone-remote
 * trigger.
 *
 * Export discipline (packages/AGENTS.md): the /client surface carries only
 * what cordis loading needs plus types.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the 'sidebar.footer.action' hole).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { UpdateEntry } from './UpdateEntry.tsx'
import { en, zh, type UpdateKey } from './locales.ts'
import { pageProtocolOf, shouldMountUpdateSeat } from './page-target.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Family self-update surface copy. */
    update: UpdateKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'update'

/** Unique occupant id inside the shared footer.action list slot. */
const ENTRY_ID = 'update'

/** Services required by this plugin. */
export const inject = ['slots', 'locale']

/**
 * Register the self-update surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-update' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-update: dictionaries')

  // Desktop shell pages (dsh-app://) never mount the seat: the desktop
  // application owns its own updater, and the seat there belongs to the
  // phone-remote trigger alone. Web pages keep the trigger.
  if (!shouldMountUpdateSeat(pageProtocolOf())) return

  // Sidebar foot entry. The shell declares 'sidebar.footer.action' (list kind:
  // multiple occupants may share the seat); registration is declaration-aware
  // via slots.inject. The seat carries the update trigger for the whole
  // session — no remote-access dependency gates it.
  ctx.slots.inject('sidebar.footer.action', () => {
    try {
      return ctx.slots.register({ name: 'sidebar.footer.action', id: ENTRY_ID, locale: NS }, UpdateEntry)
    } catch {
      return () => {}
    }
  })
}

export type { UpdateEntryProps } from './UpdateEntry.tsx'
export type { UpdatePanelProps, UpdateView } from './UpdatePanel.tsx'
export type { UpdateKey } from './locales.ts'
