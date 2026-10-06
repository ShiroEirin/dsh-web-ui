/**
 * Board-owned variant of the family plugin-card seat that can declare child
 * slots on the registration.
 *
 * The shared `installPluginCard` helper owns seat selection but cannot forward
 * a `children` declaration, and the task board's settings card declares the
 * `task-board.settings.section` seat a provider renders into. This wrapper
 * reuses the shared seat decision (`familyGroupLoaded` and the two seat keys)
 * and adds the declaration; it should collapse back into the shared helper once
 * that helper accepts children.
 *
 * @module dsh-task-board/client/board-card-seat
 */
import {
  FAMILY_PLUGIN_CARD_SEAT,
  OFFICIAL_PLUGIN_CARD_SEAT,
  familyGroupLoaded,
  type PluginCardContext,
} from './plugin-card-seat.ts'

/** One board card contribution, with the child seats it declares. */
export interface BoardCardSeat {
  bundle: string
  id: string
  order?: number
  label?: () => string
  locale: string
  /** Child slots this entry declares and renders. */
  children: Record<string, unknown>
  inject?: () => object
  component: unknown
}

function warnRefusedSeat(seat: string, error: unknown): void {
  try {
    console.warn(`[dsh-web] plugin card registration into "${seat}" was refused; the card will not render`, error)
  } catch {
    // Best-effort console write; a failed warning must not break the plugin.
  }
}

/**
 * Contribute the board's settings card to the seat this host renders, declaring
 * the child slots it owns. Mirrors the shared helper's reconcile discipline: the
 * entry moves when the family group appears, and is never in two seats at once.
 * @param ctx - client context (its slot registry decides the seat).
 * @param seat - the card contribution and its children declaration.
 */
export function installBoardCard(ctx: PluginCardContext, seat: BoardCardSeat): void {
  const slots = ctx.slots
  const component = seat.component as never
  const inject = seat.inject as never

  let dispose: (() => void) | undefined
  let current: string | undefined
  let reconciling = false

  const reconcile = (): void => {
    if (reconciling) return
    const target = familyGroupLoaded(ctx) ? FAMILY_PLUGIN_CARD_SEAT : OFFICIAL_PLUGIN_CARD_SEAT
    if (current === target) return
    reconciling = true
    const previous = dispose
    dispose = undefined
    current = undefined
    previous?.()
    try {
      dispose = slots.register((target === FAMILY_PLUGIN_CARD_SEAT
        ? {
          name: FAMILY_PLUGIN_CARD_SEAT,
          id: seat.id,
          ...(seat.order === undefined ? {} : { order: seat.order }),
          ...(seat.label === undefined ? {} : { label: seat.label }),
          locale: seat.locale,
          children: seat.children,
          ...(seat.inject === undefined ? {} : { inject }),
        }
        : {
          name: OFFICIAL_PLUGIN_CARD_SEAT,
          key: seat.bundle,
          locale: seat.locale,
          children: seat.children,
          ...(seat.inject === undefined ? {} : { inject }),
        }) as never, component) as () => void
      current = target
    } catch (error) {
      warnRefusedSeat(target, error)
    } finally {
      reconciling = false
    }
  }

  if (typeof ctx.on === 'function') {
    try {
      ctx.on('slots/changed', () => { reconcile() })
    } catch {
      // An event seat that refuses the subscription leaves the initial
      // decision in place; the card still renders in the seat chosen below.
    }
  }
  reconcile()
}
