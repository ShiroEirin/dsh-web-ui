import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/**
 * Host apply wiring: config coercion, route registration gated on `enabled`,
 * the mountOnce single-instance guard, and the Host's row-reload path.
 *
 * Under the 0.1.7 settings model the plugin's own Config schema IS its
 * settings document, and every field is volatile: the Host serves a form only
 * for an entry that declares at least one volatile field, and a write is
 * committed into the running activation's references (announced as
 * `loader/volatile-update`) instead of remounting the row. Both edges are
 * covered here — the schema markers, and the in-place re-arm that keeps the
 * probe cycle, its ledger and its routes alive across a settings save.
 * The UsageService runs against a temp DSH_HOME with no provider services.
 *
 * The plugin module is re-imported per case because the runtime keeps one
 * process-wide chain serializing a successor's first load behind the
 * predecessor's final ledger flush.
 */

type UsagePlugin = typeof import('../src/index.ts')

/** Fresh plugin module instance for one case. */
async function loadPlugin(): Promise<UsagePlugin> {
  vi.resetModules()
  return import('../src/index.ts')
}

/** One volatile field as the 0.1.7 loader commits it into a running fiber. */
function volatileField<T>(value: T): { get(): T; set(next: T): void } {
  let current = value
  return {
    get: () => current,
    set: (next) => { current = next },
  }
}

/** Fiber disposers collected from the fake ctx; run after each case to reset mountOnce. */
const disposers: Array<() => void> = []

function makeCtx() {
  const registered = new Map<string, WebRoute>()
  let sessionListenerCount = 0
  let volatileListener: ((paths: readonly (readonly string[])[]) => void) | undefined
  const effect = (fn: () => unknown) => {
    const disposer = fn()
    disposers.push(disposer as () => void)
    return disposer
  }
  const ctx = {
    effect,
    on: (event: string, listener: (paths: readonly (readonly string[])[]) => void) => {
      if (event === 'session/event') sessionListenerCount += 1
      if (event === 'loader/volatile-update') volatileListener = listener
      return () => {}
    },
    get: () => undefined,
    webServer: {
      register: (route: WebRoute) => {
        registered.set(route.path, route)
        return () => {
          registered.delete(route.path)
        }
      },
    },
  }
  return {
    ctx: ctx as never,
    registered,
    listeners: () => sessionListenerCount,
    /** Commit a volatile config change into the running activation, as the loader does. */
    commitVolatile: (paths: readonly (readonly string[])[] = [['enabled']]) => { volatileListener?.(paths) },
  }
}

/** Dispose every fiber the fake contexts collected, the way a row reload tears the old one down. */
function disposeAll(): void {
  while (disposers.length > 0) disposers.pop()!()
}

/** Let the serialized start land. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 20))
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-usage-apply-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  disposeAll()
})

describe('resolveConfig', () => {
  it('operator gets the documented defaults when no config is saved', async () => {
    // Given a plugin loaded without a saved config
    const { resolveConfig } = await loadPlugin()
    // When resolveConfig runs
    // Then the documented defaults are resolved
    expect(resolveConfig()).toEqual({ enabled: true, pollIntervalSec: 60, retainDays: 180 })
  })

  it('operator gets out-of-band values coerced into the enum and valid ones kept', async () => {
    // Given one config inside the documented ranges and one with a non-numeric poll interval
    const { resolveConfig } = await loadPlugin()
    // When resolveConfig runs on both
    // Then valid values pass through and the out-of-band interval falls back to the documented default
    expect(resolveConfig({ pollIntervalSec: 120, enabled: false, retainDays: 30 })).toEqual({
      enabled: false, pollIntervalSec: 120, retainDays: 30,
    })
    expect(resolveConfig({ pollIntervalSec: 'fast' as unknown as number }).pollIntervalSec).toBe(60)
  })

  it('operator gets a settings field for every config key because each one is volatile', async () => {
    // Given the Config schema the Host reads when it decides what the settings page may hold and write
    const { Config } = await loadPlugin()
    const dict = (Config as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
    // When every declared field is inspected
    // Then each is volatile, which is exactly what the Host requires
    // (`SettingsForms.describe` skips an entry with no volatile field, and a write to a
    // non-volatile path is refused), so no documented setting can be unservable or unwritable
    const fields = ['enabled', 'pollIntervalSec', 'retainDays']
    for (const field of fields) {
      expect(dict[field]?.meta?.volatile, field).toBe(true)
    }
  })
})

describe('host apply', () => {
  it('operator gets both routes registered and the service started when enabled', async () => {
    // Given an enabled plugin and a host context that records routes and listeners
    const { apply } = await loadPlugin()
    const { ctx, registered, listeners } = makeCtx()
    // When apply runs
    apply(ctx, {})
    // Then both usage routes are mounted and exactly one lifecycle listener is collecting
    expect([...registered.keys()].sort()).toEqual([
      '/api/dsh-usage/overview',
      '/api/dsh-usage/refresh',
    ])
    expect(listeners()).toBe(1)
  })

  it('mounts nothing when the plugin is disabled', async () => {
    const { apply } = await loadPlugin()
    const { ctx, registered, listeners } = makeCtx()
    apply(ctx, { enabled: false })
    expect(registered.size).toBe(0)
    expect(listeners()).toBe(0)
  })

  it('re-arms on a Host row reload with the newly saved config, including disable then enable', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    expect(first.registered.size).toBe(2)

    // The settings write reloads the profile row: the old fiber goes down and
    // the fresh activation carries the saved config.
    disposeAll()
    expect(first.registered.size).toBe(0)

    const disabled = makeCtx()
    apply(disabled.ctx, { enabled: false })
    await settle()
    expect(disabled.registered.size).toBe(0)
    expect(disabled.listeners()).toBe(0)

    disposeAll()
    const enabled = makeCtx()
    apply(enabled.ctx, { enabled: true })
    // The successor serializes behind the predecessor's final ledger flush.
    expect(enabled.registered.size).toBe(0)
    await settle()
    expect([...enabled.registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
    expect(enabled.listeners()).toBe(1)
  })

  it('does not start a successor whose fiber went down inside the flush window', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    disposeAll()

    const second = makeCtx()
    apply(second.ctx, {})
    expect(second.registered.size).toBe(0)
    // A row torn down before the predecessor's flush settled must leave no
    // live service behind.
    disposeAll()
    await settle()
    expect(second.registered.size).toBe(0)
    expect(second.listeners()).toBe(0)
  })

  it('keeps the flush chain for the reload after a row disposed before it started', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    disposeAll()

    // A reload landing inside the predecessor's flush window, torn down before
    // it starts, must not drop the pending write from the chain.
    const skipped = makeCtx()
    apply(skipped.ctx, {})
    disposeAll()

    const third = makeCtx()
    apply(third.ctx, {})
    expect(third.registered.size).toBe(0)
    await settle()
    expect([...third.registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
    expect(third.listeners()).toBe(1)
    expect(skipped.listeners()).toBe(0)
  })

  it('runs at most once per process (mountOnce)', async () => {
    const { apply } = await loadPlugin()
    const first = makeCtx()
    apply(first.ctx, {})
    const second = makeCtx()
    apply(second.ctx, {})
    expect(second.registered.size).toBe(0)
    expect(second.listeners()).toBe(0)
    expect(first.registered.size).toBe(2)
  })
})

describe('live settings write (volatile path)', () => {
  it('operator disabling a live row through a volatile write unmounts it without a reload', async () => {
    // Given a running activation whose enabled field the Host handed over as a live reference
    const { apply } = await loadPlugin()
    const enabled = volatileField(true)
    const { ctx, registered, commitVolatile } = makeCtx()
    apply(ctx, { enabled })
    expect(registered.size).toBe(2)
    // When the user saves the disable, which the Loader commits into that same reference
    enabled.set(false)
    commitVolatile()
    // Then the routes are released on the same activation, with no remount of the row
    expect(registered.size).toBe(0)
  })

  it('operator re-enabling a live row through a volatile write restores it in place', async () => {
    // Given a row the user has switched off through the live write path
    const { apply } = await loadPlugin()
    const enabled = volatileField(true)
    const { ctx, registered, commitVolatile } = makeCtx()
    apply(ctx, { enabled })
    enabled.set(false)
    commitVolatile()
    expect(registered.size).toBe(0)
    // When the user saves the enable again
    enabled.set(true)
    commitVolatile()
    // Then both routes come back on the same activation, after the stopped
    // instance's final ledger flush has been serialized behind
    await settle()
    expect([...registered.keys()].sort()).toEqual(['/api/dsh-usage/overview', '/api/dsh-usage/refresh'])
  })

  it('operator saving an unrelated field keeps the running service and its routes', async () => {
    // Given a live activation
    const { apply } = await loadPlugin()
    const pollIntervalSec = volatileField(60)
    const { ctx, registered, commitVolatile } = makeCtx()
    apply(ctx, { pollIntervalSec })
    // When the user changes only the poll cadence
    pollIntervalSec.set(300)
    commitVolatile([['pollIntervalSec']])
    // Then the routes stay registered: the edit reached the running instance
    // instead of remounting it, so the ledger and the probe cycle survive
    expect(registered.size).toBe(2)
  })

  it('operator gets the newly committed cadence read at call time, not the activation value', async () => {
    // Given a live activation started with the default cadence
    const { apply, resolveConfig } = await loadPlugin()
    const pollIntervalSec = volatileField(60)
    const { ctx, commitVolatile } = makeCtx()
    apply(ctx, { pollIntervalSec })
    // When the user commits a new cadence
    pollIntervalSec.set(300)
    commitVolatile([['pollIntervalSec']])
    // Then re-reading the settings follows the live reference rather than the
    // value the row was activated with
    expect(resolveConfig({ pollIntervalSec }).pollIntervalSec).toBe(300)
  })
})
