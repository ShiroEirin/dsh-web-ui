/**
 * Shell row config surface: the contract that makes an aggregate family row
 * configurable at all.
 *
 * The Host settings surface serves a form — and accepts a write — only for an
 * entry whose own Config schema declares the edited field as volatile. A
 * shell-wrapped family row's Config belongs to THIS package, so the shell must
 * expose the family plugin's fields itself: it declares a shapeless volatile
 * schema (`any`, not an object, so the family's own fields stay at the form
 * root where a standalone install of the same package keeps them) and forwards
 * every row key but its own `plugin` to the real module. Because the schema is
 * root-volatile, the Loader commits an edit into the running entry instead of
 * remounting it, and the shell re-mounts the family plugin with the committed
 * config — the path these tests pin, together with the family schema still
 * governing the value it validates on mount.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, _resetDegradedRouteForTest, Config } from '../src/shell.ts'
import { HOST_BOOT, dshIt, runBootScript } from './boot-harness.ts'

/** One captured ctx double for the shell's config-sync path. */
function mockCtx() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const mounts: Array<{ plugin: unknown; config: unknown; disposed: () => boolean }> = []
  const effects: Array<() => void> = []
  const ctx = {
    inject: (_deps: readonly string[], _cb: (scoped: unknown) => void) => {},
    effect: (fn: () => () => void) => { effects.push(fn()) },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const held = listeners.get(event) ?? []
      held.push(listener)
      listeners.set(event, held)
      return () => {}
    },
    plugin: vi.fn((plugin: unknown, config: unknown) => {
      let live = true
      mounts.push({ plugin, config, disposed: () => !live })
      return { dispose: async () => { live = false } }
    }),
  }
  return {
    ctx,
    mounts,
    fire: (event: string): void => {
      for (const listener of listeners.get(event) ?? []) listener([])
    },
  }
}

/** A row config reference as the Loader hands it for a root-volatile schema. */
function liveConfig(config: Record<string, unknown>): { get: () => unknown; commit: (next: Record<string, unknown>) => void } {
  let current: Record<string, unknown> = config
  return {
    get: () => current,
    commit: (next) => { current = next },
  }
}

/**
 * Run the shell's serialized sync queue to completion without touching the
 * clock: every step awaits an already-resolved promise (the ESM cache serves a
 * repeated import), so microtask ticks are the whole wait.
 */
async function drainUntil(reached: () => boolean, ticks = 200): Promise<void> {
  for (let i = 0; i < ticks && !reached(); i++) await Promise.resolve()
}

describe('shell row config schema', () => {
  it('operator finds a family row on the settings surface because the shell schema is root-volatile', () => {
    // Given the Config schema the Host projects a family row's form from
    // When the surface reads the schema's shape and volatility
    // Then the root declares volatility (an entry without one gets no form at
    // all, and `isVolatilePath` refuses every write outside such a path) and
    // the schema is not an object (which would project only its own keys)
    expect((Config as unknown as { meta: { volatile?: boolean } }).meta.volatile).toBe(true)
    expect((Config as unknown as { type: string }).type).not.toBe('object')
  })

  it('operator edits any family field because one whole row config validates into a single reference', () => {
    // Given a flattened row config as the aggregate writes it
    // When the shell schema validates it
    // Then it is accepted whole and handed back as the one live reference the
    // Loader commits a later edit into
    const validated = (Config as unknown as { '~standard': { validate: (value: unknown) => { value?: unknown } } })['~standard'].validate({ plugin: '@linxin666/dsh-client-ui-task-board', maxSubtaskDepth: 2 })
    const value = validated.value as { get?: unknown } | undefined
    expect(typeof value?.get).toBe('function')
    expect((value as { get: () => unknown }).get()).toEqual({ plugin: '@linxin666/dsh-client-ui-task-board', maxSubtaskDepth: 2 })
  })
})

describe('shell config sync', () => {
  it('operator mounts the real plugin with the family fields alone, never the shell key', async () => {
    // Given a row config naming the plugin plus two of its own fields
    const { ctx, mounts } = mockCtx()

    // When the shell applies
    await apply(ctx as never, { plugin: 'node:events', maxSubtaskDepth: 2, enabled: true })

    // Then the real plugin was mounted once with the family fields, and the
    // shell's own key never reached it
    expect(mounts).toHaveLength(1)
    expect(mounts[0].config).toEqual({ maxSubtaskDepth: 2, enabled: true })
  })

  it('operator sees the family plugin re-mounted with the committed config after a volatile update', async () => {
    // Given a mounted row whose config the Loader hands as a live reference
    const { ctx, mounts, fire } = mockCtx()
    const config = liveConfig({ plugin: 'node:events', maxSubtaskDepth: 1 })
    await apply(ctx as never, config as never)
    expect(mounts[0].config).toEqual({ maxSubtaskDepth: 1 })

    // When a settings edit is committed into that reference and announced
    config.commit({ plugin: 'node:events', maxSubtaskDepth: 3 })
    fire('loader/volatile-update')
    await drainUntil(() => mounts.length > 1)

    // Then the previous mount is gone and the family plugin runs the new value
    expect(mounts).toHaveLength(2)
    expect(mounts[0].disposed()).toBe(true)
    expect(mounts[1].config).toEqual({ maxSubtaskDepth: 3 })
  })

  it('operator sees no re-mount when the announced update carries the same config', async () => {
    // Given a mounted row with no pending change
    const { ctx, mounts, fire } = mockCtx()
    const config = liveConfig({ plugin: 'node:events', enabled: true })
    await apply(ctx as never, config as never)

    // When an update is announced for a value that did not move
    fire('loader/volatile-update')
    await drainUntil(() => mounts.length !== 1)

    // Then the running plugin is left untouched
    expect(mounts).toHaveLength(1)
    expect(mounts[0].disposed()).toBe(false)
  })

  it('operator gets no mount at all for a retired plugin row', async () => {
    // Given a stale row from a profile older than the retirement
    const { ctx, mounts } = mockCtx()

    // When the shell applies
    await apply(ctx as never, { plugin: '@linxin666/dsh-perf' })

    // Then nothing mounts and the boot stays healthy
    expect(mounts).toHaveLength(0)
  })
})

describe('shelled family row configuration (real boot)', () => {
  /** A family fixture whose own schema governs the forwarded value. */
  const familyFixture = [
    `import z from '__HOST__/schemastery/lib/index.mjs'`,
    `export const Config = z.object({ maxDepth: z.number().min(1).max(3).default(1).volatile() })`,
    `export function apply(ctx, config) { globalThis.__FAMILY = JSON.stringify({ maxDepth: config.maxDepth.get() }) }`,
  ].join('\n')

  /** One boot scenario: a shelled family row plus a healthy sibling. */
  function familyScenario(id: string, config: string): string {
    return [
      `const { boot } = await import(${JSON.stringify(HOST_BOOT)})`,
      `const rows = [`,
      `  { insert: [{ id: ${JSON.stringify(id)}, name: '__PKG__/shells/shell.js', config: ${config} }] },`,
      `  { insert: [{ id: 'good-entry', name: '__DIR__/good.mjs' }] },`,
      `]`,
      `try {`,
      `  const ctx = await boot('shell-family', '__DIR__/cordis.yml', rows)`,
      `  const loader = ctx.get('loader')`,
      `  const include = [...loader.entries()][0]`,
      `  const entries = [...include.subtree.entries()].map(e => ({ id: e.options.id, state: e.fiber ? e.fiber.state : null }))`,
      `  await new Promise(r => setTimeout(r, 100))`,
      `  console.log(JSON.stringify({ ok: true, entries, family: globalThis.__FAMILY ?? null, goodSvc: ctx.get('goodSvc') ?? null }))`,
      `} catch (error) {`,
      `  console.log(JSON.stringify({ ok: false, error: String(error.message).slice(0, 160) }))`,
      `}`,
    ].join('\n')
  }

  dshIt('operator configures a shelled family row and the family schema validates the value', () => {
    // Given an aggregate row mounting the shell with the plugin's field beside
    // the shell's own `plugin` key
    const result = runBootScript(familyScenario('shell-family', `{ plugin: '__DIR__/family.mjs', maxDepth: 2 }`), { 'family.mjs': familyFixture })

    // When the profile boots
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; family: string | null }

    // Then the shell entry is ACTIVE and the family plugin received exactly the
    // family fields, resolved by its own schema
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-family')?.state).toBe(2)
    expect(facts.family).toBe('{"maxDepth":2}')
  })

  dshIt('operator sees only that row degrade when the family schema refuses the config', () => {
    // Given a row whose field is outside the family schema's range
    const result = runBootScript(familyScenario('shell-refused', `{ plugin: '__DIR__/family.mjs', maxDepth: 9 }`), { 'family.mjs': familyFixture })

    // When the profile boots
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; family: string | null; goodSvc: unknown }
    _resetDegradedRouteForTest()

    // Then the shell entry stays ACTIVE (the boot audit sees a healthy tree),
    // the family plugin never mounted, and the healthy sibling is untouched
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-refused')?.state).toBe(2)
    expect(facts.entries.find(e => e.id === 'good-entry')?.state).toBe(2)
    expect(facts.family).toBeNull()
    expect(facts.goodSvc).toEqual({ ok: true })
  })
})
