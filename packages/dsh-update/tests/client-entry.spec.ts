// @vitest-environment jsdom
/**
 * The browser half's registration contract: this package's own apply mounts the
 * update seat into the official `sidebar.footer.action` slot under the
 * `update` locale namespace on web pages, and mounts nothing on the desktop
 * shell's application-delivered page. Seat independence from dsh-remote-web-ui
 * is the reason the capability was split out, so both halves are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import { isApplicationDeliveredPage, shouldMountUpdateSeat } from '../src/client/page-target.ts'

/** Client context double exposing only the services this plugin declares. */
function ctxDouble(): {
  ctx: never
  injected: string[]
  registered: Array<{ name: string; id: string; locale?: string }>
  dictionaries: string[]
} {
  const injected: string[] = []
  const registered: Array<{ name: string; id: string; locale?: string }> = []
  const dictionaries: string[] = []
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: {
      register: (ns: string) => {
        dictionaries.push(ns)
        return () => {}
      },
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (key: string, factory?: () => unknown) => {
        injected.push(key)
        factory?.()
        return () => {}
      },
      register: (entry: { name: string; id: string; locale?: string }) => {
        registered.push(entry)
        return () => {}
      },
    },
  }
  return { ctx: ctx as never, injected, registered, dictionaries }
}

describe('update client entry registration', () => {
  it('operator: a web page mounts the update seat in the shared footer slot', () => {
    // Given the jsdom page origin (http:) and a client context carrying the
    // slots and locale services this plugin declares
    const { ctx, injected, registered, dictionaries } = ctxDouble()
    // When the plugin applies
    apply(ctx)
    // Then the seat is the official footer slot, with entry id and dictionary
    // namespace both `update`
    expect(injected).toEqual(['sidebar.footer.action'])
    expect(registered).toEqual([{ name: 'sidebar.footer.action', id: 'update', locale: 'update' }])
    expect(dictionaries).toEqual(['update'])
  })
})

describe('update seat placement', () => {
  it('operator: the desktop shell page carries no update seat', () => {
    // Given the DSH Desktop shell's own delivery scheme
    // When the placement decision runs
    // Then the seat is refused, because that application owns its own updater
    expect(isApplicationDeliveredPage('dsh-app:')).toBe(true)
    expect(shouldMountUpdateSeat('dsh-app:')).toBe(false)
  })

  it('operator: a web page keeps the update seat', () => {
    // Given the web transports and the documents a web page mints
    const webSchemes = ['http:', 'https:', 'blob:', 'data:', 'about:', 'filesystem:']
    // When the placement decision runs for each scheme
    // Then every web page keeps the seat
    for (const scheme of webSchemes) {
      expect(shouldMountUpdateSeat(scheme), scheme).toBe(true)
    }
  })

  it('operator: an unreadable scheme stays on the web side', () => {
    // Given a page whose scheme could not be read
    // When the placement decision runs
    // Then the seat is kept (a missing scheme is not evidence of a desktop app)
    expect(isApplicationDeliveredPage('')).toBe(false)
    expect(shouldMountUpdateSeat('')).toBe(true)
  })
})
