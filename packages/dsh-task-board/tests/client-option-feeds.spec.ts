// @vitest-environment jsdom
/**
 * Execution-target option feeds on the client apply path.
 *
 * The mode picker reads the agent-preset roster from the controller, which the
 * apply wiring fills from the runtime. A feed that is defined but never invoked
 * leaves the picker permanently empty, so this spec observes the controller's
 * options after apply() rather than trusting the wiring's shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

const PRESET_ROSTER = [
  { id: 'standard', name: '', description: '', isDefault: true },
  { id: 'house-style', name: 'House Style', description: 'our preset', isDefault: false },
]

function unavailableSettingsForm() {
  return {
    getSnapshot: () => ({ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }),
    subscribe: () => () => {},
    mutate: async () => false,
    set: async () => false,
    unset: async () => false,
  }
}

function applyContext() {
  const disposers: Array<() => void> = []
  const registrations: Array<{ name: string; options: Record<string, unknown> }> = []
  const services: Record<string, unknown> = {
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} }, create: async () => ({ workspaceId: 'w1' }) },
    // No generated api-remotes face: the wiring falls back to the connection RPC.
    remote: {},
    connection: { api: { agentPresets: { list: async () => ({ result: { ok: true, value: { presets: PRESET_ROSTER } } }) } } },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
  }
  const slots = {
    register: (options: Record<string, unknown>) => {
      registrations.push({ name: String(options.name), options })
      const release = (): void => {}
      disposers.push(release)
      return release
    },
    inject: (_key: string, callback: () => () => void) => {
      const release = callback()
      disposers.push(release)
      return release
    },
  }
  const ctx = {
    effect(callback: () => void | (() => void)) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    get: (name: string) => services[name],
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key: string) => key, subscribe: () => () => {} },
    configForms: { get: () => unavailableSettingsForm(), describe: () => { throw new Error('no describe mirror') } },
    slots,
  }
  return { ctx: ctx as never, disposers, registrations }
}

/** The board controller the panel page receives through its slot injection. */
function boardController(registrations: Array<{ name: string; options: Record<string, unknown> }>) {
  const page = registrations.find(entry => entry.name === 'main')
  const inject = page?.options.inject as (() => { controller: { getSnapshot: () => { executionOptions: { presets?: readonly unknown[] } } } }) | undefined
  return inject?.().controller
}

describe('task-board client execution-target option feeds', () => {
  beforeEach(() => {
    delete (globalThis as { __dshTaskboardApplied?: boolean }).__dshTaskboardApplied
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('operator opening the mode picker sees the deployment preset roster', async () => {
    // Given a client context whose host serves a two-row preset roster
    const { ctx, registrations } = applyContext()

    // When the plugin applies and the roster read settles
    apply(ctx)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Then the controller behind the board carries that roster
    const controller = boardController(registrations)
    expect(controller?.getSnapshot().executionOptions.presets).toEqual([
      { id: 'standard', name: '', description: '', broken: undefined, isDefault: true },
      { id: 'house-style', name: 'House Style', description: 'our preset', broken: undefined, isDefault: false },
    ])
  })
})
