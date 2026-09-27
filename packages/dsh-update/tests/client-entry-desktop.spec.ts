// @vitest-environment jsdom
/**
 * The desktop shell's page carries no update seat: the same apply() that mounts
 * the seat on a web page must mount nothing on an application-delivered page,
 * because the desktop application owns its own updater and that page's sidebar
 * seat keeps only the phone-remote trigger.
 *
 * The page's scheme is installed by replacing the ambient `location` rather
 * than by pointing jsdom at `dsh-app://app/`. An opaque origin makes jsdom's
 * own `localStorage` getter throw `SecurityError: localStorage is not
 * available for opaque origins`, and vitest reads that property while it
 * populates the environment's globals — so the worker died during setup and
 * the file was reported as "failed to start" instead of as a test
 * (`pnpm test` and CI on dev were red for exactly this reason). The plugin
 * reads the scheme through `pageProtocolOf()`, which takes the window as a
 * parameter, so a stand-in location exercises the same branch with a usable
 * origin underneath.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('desktop shell page', () => {
  it('operator: the update seat is not mounted on the desktop shell page', () => {
    // Given the desktop shell's own delivery scheme on the ambient location
    const real = Object.getOwnPropertyDescriptor(globalThis, 'location')
    expect(real?.configurable).toBe(true)
    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'dsh-app:', hostname: 'app' },
      configurable: true,
      writable: true,
    })
    try {
      // And a client context carrying the slots and locale services
      expect(window.location.protocol).toBe('dsh-app:')
      expect(window.location.hostname).toBe('app')
      const injected: string[] = []
      const registered: unknown[] = []
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
          register: (entry: unknown) => {
            registered.push(entry)
            return () => {}
          },
        },
      }
      // When the plugin applies
      apply(ctx as never)
      // Then the dictionaries still register and the footer seat stays unmounted
      expect(dictionaries).toEqual(['update'])
      expect(injected).toEqual([])
      expect(registered).toEqual([])
    } finally {
      Object.defineProperty(globalThis, 'location', real as PropertyDescriptor)
    }
  })
})
