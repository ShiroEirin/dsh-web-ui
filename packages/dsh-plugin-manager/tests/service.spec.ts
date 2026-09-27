/**
 * Contract tests for the 'pluginManager' cordis service: apply() provides the
 * shared dual-channel face with the contract shape, and onChange listeners
 * fire after successful mutations (a throwing listener never breaks the
 * others, and a failed mutation notifies nobody), with the returned
 * unsubscribe stopping delivery. The connection RPC and the gateway fetch are
 * fakes handed to the context, so the module graph is never patched; the mode
 * probe rides the fetch fake, so every mutation resolves through the official
 * channel fake.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply, type PluginManagerFace } from '../src/client/index.ts'
import type { InstalledPluginItem } from '../src/core/protocol.ts'

const plugin: InstalledPluginItem = {
  id: 'p1', name: 'p1', version: '1.0.0', source: { kind: 'npm', spec: '@scope/p1' }, installedAt: '2026-08-18T00:00:00.000Z', enabled: true,
}

interface Setup {
  face: PluginManagerFace
  slotFace: () => unknown
  slotName: () => string | undefined
  rpcCall: ReturnType<typeof vi.fn>
}

/** Run apply() against a fake context and capture the provided face. */
function setup(): Setup {
  const rpcCall = vi.fn(async (channel: string, endpoint: string) => {
    if (channel === '/plugin-installer') {
      if (endpoint === 'install' || endpoint === 'update' || endpoint === 'set-enabled') return { ok: true as const, value: { plugin } }
      if (endpoint === 'uninstall') return { ok: true as const, value: { plugins: [] } }
      if (endpoint === 'list') return { ok: true as const, value: { plugins: [plugin] } }
      if (endpoint === 'status') return { ok: true as const, value: { progress: { kind: 'idle', stage: 'fetch' } } }
      if (endpoint === 'check-updates') return { ok: true as const, value: { updates: [] } }
    }
    return { ok: false as const, error: { code: 'unknown', message: 'unexpected call' } }
  })
  const connection = { isLoopback: true, rpc: { call: rpcCall } } as unknown as ConnectionHandle

  const provided = new Map<string, unknown>()
  let slotName: string | undefined
  let slotFace: () => unknown = () => undefined
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
    get: (name: string) => name === 'connection' ? connection : undefined,
    provide: vi.fn((name: string, value: unknown) => { provided.set(name, value); return () => {} }),
    slots: {
      inject: vi.fn((_name: string, cb: () => unknown) => { cb() }),
      register: vi.fn((options: { name: string; inject: () => unknown }) => {
        slotName = options.name
        slotFace = options.inject
        return () => {}
      }),
    },
  }
  apply(ctx as unknown as ClientContext)

  const face = provided.get('pluginManager') as PluginManagerFace | undefined
  if (face === undefined) throw new Error('apply() did not provide the pluginManager service')
  return { face, slotFace, slotName: () => slotName, rpcCall }
}

afterEach(() => { vi.unstubAllGlobals() })

/** Stub the gateway /mode probe so ensureMode picks the official channel. */
function stubOfficialMode(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ official: true }), { status: 200 })))
}

describe('pluginManager cordis service', () => {
  it('user gets the pluginManager service with the contract shape on the official update seat', () => {
    // Given the plugin applies against a client context
    const { face, slotFace, slotName } = setup()

    // When the service and its slot contribution are read back
    const shape = {
      isLoopback: typeof face.isLoopback,
      list: typeof face.list,
      install: typeof face.install,
      uninstall: typeof face.uninstall,
      status: typeof face.status,
      failures: typeof face.failures,
      checkUpdates: typeof face.checkUpdates,
      onChange: typeof face.onChange,
    }

    // Then the frozen cross-plugin contract is present, the update patch shares
    // the same face instance, and it registers into the official page's seat
    expect(shape).toEqual({
      isLoopback: 'boolean', list: 'function', install: 'function', uninstall: 'function',
      status: 'function', failures: 'function', checkUpdates: 'function', onChange: 'function',
    })
    expect(slotFace()).toBe(face)
    expect(slotName()).toBe('plugins.detail.section')
  })

  it('user mutations notify onChange listeners after a successful install and uninstall', async () => {
    // Given the official channel is selected and a listener is subscribed
    stubOfficialMode()
    const { face } = setup()
    const seen: string[] = []
    face.onChange(() => { seen.push('changed') })

    // When an install and then an uninstall succeed
    await face.install('@scope/p1')
    await face.uninstall('p1')

    // Then both mutations notified the subscriber
    expect(seen).toEqual(['changed', 'changed'])
  })

  it('operator list reads the in-process official channel when desktop mode is indeterminate', async () => {
    // Given the gateway reports an indeterminate mode (desktop runtimes)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ official: null }), { status: 200 })))
    const { face, rpcCall } = setup()

    // When the face lists the installed plugins
    const listed = await face.list()

    // Then the row came from the official installer channel, not the gateway
    expect(listed).toEqual([plugin])
    expect(rpcCall).toHaveBeenCalledWith('/plugin-installer', 'list', {})
  })

  it('user listeners stay independent: a throwing one does not block the rest or a failed mutation', async () => {
    // Given one listener throws and another records
    stubOfficialMode()
    const { face, rpcCall } = setup()
    const seen: string[] = []
    face.onChange(() => { throw new Error('consumer listener failure') })
    face.onChange(() => { seen.push('changed') })

    // When an install fails and then a later one succeeds
    rpcCall.mockImplementationOnce(async () => ({ ok: false as const, error: { code: 'boom', message: 'install failed' } }))
    await expect(face.install('@scope/p1')).rejects.toThrow('install failed')
    const afterFailure = [...seen]
    await face.install('@scope/p1')

    // Then the failure notified nobody and the success reached the surviving listener
    expect(afterFailure).toEqual([])
    expect(seen).toEqual(['changed'])
  })

  it('user who unsubscribes stops receiving mutation notifications', async () => {
    // Given a subscribed listener that then unsubscribes
    stubOfficialMode()
    const { face } = setup()
    const seen: string[] = []
    const off = face.onChange(() => { seen.push('changed') })
    off()

    // When a mutation succeeds afterwards
    await face.install('@scope/p1')

    // Then the unsubscribed listener heard nothing
    expect(seen).toEqual([])
  })
})
