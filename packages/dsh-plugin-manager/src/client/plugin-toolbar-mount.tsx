/**
 * Mounting the update toolbar beside the official Plugins page's "Installed"
 * heading.
 *
 * The page renders that heading itself — `<section data-plugin-group="bundles">
 * <div class="groupHead"><h3>Installed</h3><span>7</span></div>…` — and declares
 * no seat next to it: its extension points are `plugins.detail.*` (per page),
 * `plugins.bundle.config` / `plugins.row.config` / `plugins.item` (configuration
 * entries) and `plugins.bundle.activation`. A list-level action therefore has
 * to be inserted into the page's own chrome, the same way the sidebar foot card
 * is inserted above the Settings row.
 *
 * The container is a plain element carrying its own React root, so it can never
 * disturb the page's reconciliation, and it re-seats itself through the
 * page-wide body-mutation hub: a re-render that relocates or drops the heading
 * is followed on the next frame, and a panel switch that unmounts the list
 * simply detaches the container until the list returns.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { subscribeBodyInvalidations } from './body-mutations.ts'
import { PluginListToolbar, type PluginListToolbarProps } from './PluginListToolbar.tsx'
import css from './plugin-manager.module.css'

/** Stable attribute identifying the injected container (mount idempotency). */
export const TOOLBAR_MOUNT_SELECTOR = '[data-dsh-plugin-manager-toolbar]'

/** Toolbar props without the translate function, which is rebuilt per render. */
export type PluginListToolbarMountInput = Omit<PluginListToolbarProps, 't'> & {
  /** Translate in the namespace, read on every render so a language switch lands. */
  t: PluginListToolbarProps['t']
}

/** The mount's inputs. */
export interface PluginToolbarMountOptions {
  /** Build the toolbar props; called on mount and on every locale change. */
  props: () => PluginListToolbarMountInput
  /** Locale change subscription (ctx.locale.subscribe); re-renders the toolbar. */
  subscribe?: (listener: () => void) => () => void
}

/**
 * The official page's "Installed" group heading, when it is mounted. Class
 * names are CSS-module hashes in the official bundle, so the seat is found
 * through the page's own data attributes plus DOM position.
 * @returns the heading element to append into, or undefined off the list view.
 */
export function toolbarSeat(): HTMLElement | undefined {
  const page = document.querySelector('[data-plugin-panel]')
  const group = page?.querySelector('[data-plugin-group="bundles"]')
  const head = group?.firstElementChild
  return head instanceof HTMLElement ? head : undefined
}

/**
 * Mount the toolbar into the Installed heading.
 * @param options - props factory and the optional locale subscription.
 * @returns disposer removing the container, its observers and its React root.
 */
export function mountPluginListToolbar(options: PluginToolbarMountOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  // DOM-level idempotency: whatever path mounted a toolbar before this call
  // (a duplicated apply, an HMR re-injection), never mount a second one.
  if (document.querySelector(TOOLBAR_MOUNT_SELECTOR) !== null) return () => {}

  const container = document.createElement('div')
  container.setAttribute('data-dsh-plugin-manager-toolbar', '')
  container.className = css.mount
  const root: Root = createRoot(container)
  const render = (): void => {
    root.render(createElement(PluginListToolbar, options.props()))
  }
  render()

  /** Keep the container inside the heading; detach while the list is away. */
  const place = (): void => {
    const seat = toolbarSeat()
    if (seat === undefined) {
      container.remove()
      return
    }
    if (container.parentElement !== seat) seat.append(container)
  }
  place()

  const unsubscribeBody = subscribeBodyInvalidations(place)
  const unsubscribeLocale = options.subscribe === undefined ? ((): void => {}) : options.subscribe(render)

  return () => {
    unsubscribeBody()
    unsubscribeLocale()
    root.unmount()
    container.remove()
  }
}
