/**
 * The store's official-face bridge, exercised on a REAL cordis context.
 *
 * The two surfaces the Workshop reuses are ordinary cordis services: the API
 * gateway registers every remote namespace as `remote.<namespace>`, and the
 * official Plugins page provides `pluginNavigation`. This suite proves the
 * optional `ctx.inject` wiring resolves exactly those service names and clears
 * again when the host withdraws them — something a hand-written context double
 * cannot show.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  bridgeNativePluginFaces,
  getNativePluginFaces,
  installViaOfficialManager,
  type NativePluginManagerService,
  type PluginNavigationService,
} from '../src/client/native-plugin-faces.ts'

describe('official plugin faces bridge', () => {
  it('user gets both official faces once the host publishes them, and loses them when it stops', async () => {
    // Given a host that publishes neither face
    const root = new Context()
    bridgeNativePluginFaces(root as never)
    expect(getNativePluginFaces().manager).toBeNull()
    expect(getNativePluginFaces().navigation).toBeNull()

    // When the host publishes the in-process manager and the Plugins page navigation
    const manager: NativePluginManagerService = { installBundle: async () => ({ ok: true, value: {} }) }
    const navigation: PluginNavigationService = { openBundle: vi.fn() }
    const unprovideManager = root.provide('remote.pluginManager', manager as never)
    const unprovideNavigation = root.provide('pluginNavigation', navigation as never)
    await vi.waitFor(() => {
      expect(getNativePluginFaces().manager).toBe(manager)
      expect(getNativePluginFaces().navigation).toBe(navigation)
    })

    // Then withdrawing the services clears the store again
    await unprovideManager()
    await unprovideNavigation()
    await vi.waitFor(() => {
      expect(getNativePluginFaces().manager).toBeNull()
      expect(getNativePluginFaces().navigation).toBeNull()
    })
  })
})

describe('official install through the remote face', () => {
  it('user gets a green install reported without an error', async () => {
    // Given an official manager that accepts the spec
    const installBundle = vi.fn(async () => ({ ok: true as const, value: {} }))

    // When the store installs through it
    const settled = installViaOfficialManager({ installBundle } as never, 'dsh-tui', 'req-1')

    // Then the call carries the activation choice and the request id, and settles
    await expect(settled).resolves.toBeUndefined()
    expect(installBundle).toHaveBeenCalledWith('dsh-tui', { enabled: true, requestId: 'req-1' })
  })

  it('user gets the manager refusal surfaced as the install error', async () => {
    // Given the official manager refuses the spec
    const manager = {
      installBundle: async () => ({ ok: false as const, error: { code: 'not-a-bundle', message: 'plugin-manager: not a bundle' } }),
    }

    // When the store installs through it
    const settled = installViaOfficialManager(manager as never, 'dsh-tui', 'req-2')

    // Then the manager's own message is what the card reports
    await expect(settled).rejects.toThrow('plugin-manager: not a bundle')
  })
})
