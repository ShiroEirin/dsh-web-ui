import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountClientChildren } from '../src/client/mount-children.ts'

const MOUNTED_PLUGINS = Symbol.for('dsh-web.mounted-plugins')

vi.mock('../src/client/children.generated.ts', () => ({
  clientChildren: [
    { name: '@linxin666/fake-own-entry', module: { apply: () => {} } },
    { name: '@linxin666/fake-mounts', module: { apply: () => {} } },
    { name: '@linxin666/fake-sync-throw', module: { apply: () => {} } },
    { name: '@linxin666/fake-no-apply', module: {} },
    { name: '@linxin666/dsh-client-ui-plugin-manager', module: { apply: () => {} } },
  ],
}))

interface RecordedDefinition {
  name: string
  inject: string[]
  apply: unknown
}

function fakeCtx(outcomes: Record<string, 'ok' | 'reject' | 'throw'> = {}) {
  const mounted: Array<RecordedDefinition> = []
  const cleanups: Array<() => void> = []
  const ctx = {
    plugin(def: RecordedDefinition) {
      const outcome = outcomes[def.name] ?? 'ok'
      if (outcome === 'throw') throw new Error('sync boom')
      if (outcome === 'reject') return Promise.reject(new Error('async boom'))
      mounted.push(def)
      return Promise.resolve()
    },
    // The aggregate's fiber seat: mountClientChildren registers its claim
    // cleanup here, and a fiber teardown runs every disposer.
    effect(callback: () => void | (() => void)) {
      const disposer = callback()
      if (typeof disposer === 'function') cleanups.push(disposer)
    },
  }
  return { ctx: ctx as never, mounted, cleanups }
}

/** Names currently claimed in the shared mount registry. */
function registryNames(): string[] {
  const registry = (globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS] as Set<string> | undefined
  return [...(registry ?? [])]
}

function bootWith(entries: Array<string | { id?: string }>): void {
  vi.stubGlobal('__DSH_BOOT__', {
    entries: entries.map((entry) => typeof entry === 'string' ? { id: entry } : entry),
  })
}

/** Stub the row-state route answer; undefined simulates a host without the route. */
function rowsRouteAnswer(active: string[] | undefined): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (active === undefined) throw new Error('fetch failed: no route')
    return {
      ok: true,
      json: async () => ({ ok: true, children: active }),
    }
  }))
}

describe('mountClientChildren', () => {
  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Default: the host predates the rows route — fail open like before.
    rowsRouteAnswer(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(console.error).mockRestore()
  })

  it('skips children the loader serves through their own entries and mounts the rest', async () => {
    bootWith(['@linxin666/fake-own-entry'])
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-mounts',
      '@linxin666/fake-sync-throw',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
    expect(mounted[0].inject).toEqual([])
  })

  it('mounts every child when no boot payload is present', async () => {
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted).toHaveLength(4) // every child except the no-apply shape
  })

  it('mounts family children under the real aggregate boot graph (#1372 regression)', async () => {
    // Real host wire shape: boot entries are client-bundle graph rows whose ids
    // are package names (graphRow). Patch row ids like `web-ui-plugin-manager`
    // never appear, so the children must mount despite a fully-populated graph.
    bootWith([
      { id: '@deepseek-ai/dsh-client-modules' },
      { id: '@linxin666/dsh-web-all' },
      { id: '@linxin666/dsh-perf' },
    ])
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted.some((def) => def.name === '@linxin666/dsh-client-ui-plugin-manager')).toBe(true)
    expect(mounted).toHaveLength(4) // every child except the no-apply shape
  })

  it('keeps mounting siblings when one child throws synchronously', async () => {
    bootWith([])
    const { ctx, mounted } = fakeCtx({ '@linxin666/fake-mounts': 'throw' })
    await expect(mountClientChildren(ctx)).resolves.toBeUndefined()
    expect(mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-sync-throw',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
    expect(console.error).toHaveBeenCalledTimes(2) // the throw + the no-apply shape
  })

  it('captures async fiber rejections without escaping', async () => {
    bootWith([])
    const { ctx, mounted } = fakeCtx({ '@linxin666/fake-sync-throw': 'reject' })
    await mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-mounts',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(console.error).toHaveBeenCalledWith(
      '[dsh-web-all] client child degraded: @linxin666/fake-sync-throw',
      expect.any(Error),
    )
  })

  it('honours the shared mount registry across instances', async () => {
    bootWith([])
    ;(globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS] = new Set(['@linxin666/fake-mounts'])
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-sync-throw',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
  })

  it('hides children whose family row is inactive (#1372 row gating)', async () => {
    bootWith([])
    rowsRouteAnswer([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-sync-throw',
      '@linxin666/fake-no-apply',
      // @linxin666/fake-mounts disabled through a user patch override
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-sync-throw',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
  })

  it('fails open when the rows route answers a non-200', async () => {
    bootWith([])
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted).toHaveLength(4)
  })

  it('fails open when the rows payload shape is wrong', async () => {
    bootWith([])
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, children: ['@linxin666/fake-mounts', 42] }),
    })))
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted).toHaveLength(4)
  })

  it('fails open when the rows answer is not json', async () => {
    bootWith([])
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => { throw new Error('invalid json') },
    })))
    const { ctx, mounted } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted).toHaveLength(4)
  })

  it('operator sees a rebuilt aggregate mount every family child again after the old fiber unloads', async () => {
    // Regression (2026-09-24): the loader replaces a rebuilt application entry
    // in place, so the successor apply found every child still claimed by its
    // dead predecessor and mounted none of them — every family surface
    // (usage, task board, market, archive) stayed gone until a manual reload.
    // Given an aggregate that already mounted and claimed its children
    bootWith([])
    const first = fakeCtx()
    await mountClientChildren(first.ctx)
    // Every child is claimed, including the shapeless one: it claims before
    // the apply-shape check bails out.
    expect(registryNames()).toHaveLength(5)

    // When the loader disposes that fiber for the rebuilt bundle
    for (const dispose of first.cleanups.splice(0).reverse()) dispose()

    // Then the successor apply claims and mounts the same children again
    expect(registryNames()).toEqual([])
    const second = fakeCtx()
    await mountClientChildren(second.ctx)
    expect(second.mounted.map((def) => def.name)).toEqual([
      '@linxin666/fake-own-entry',
      '@linxin666/fake-mounts',
      '@linxin666/fake-sync-throw',
      '@linxin666/dsh-client-ui-plugin-manager',
    ])
  })

  it('operator keeps the child a sibling instance claimed while this mount releases its own', async () => {
    // Given a sibling module instance (npm copy next to the repository link)
    // that already claimed one child, and a second instance mounting the rest
    bootWith([])
    ;(globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS] = new Set(['@linxin666/fake-mounts'])
    const { ctx, mounted, cleanups } = fakeCtx()
    await mountClientChildren(ctx)
    expect(mounted).toHaveLength(3)

    // When this instance's fiber unloads
    for (const dispose of cleanups) dispose()

    // Then only its own claims are gone and the sibling's claim survives
    expect(registryNames()).toEqual(['@linxin666/fake-mounts'])
  })
})
