/**
 * Host half of the GitHub provider extension: the configuration an operator
 * writes in a profile patch, and the lifecycle a single mount takes.
 *
 * The repository schema itself is pinned by `github-config.spec.ts`, and the
 * real-registry wiring — a board service published before or after this row
 * activates, and what a switch flip releases — by `extension-injection.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_TOKEN_ENV, PACKAGE_NAME, apply, readConfigField, resolveProviderSettings } from '../src/index.ts'

/**
 * Host context double that records the effects one mount registers and hands
 * back their disposers, the way cordis runs an effect immediately and treats
 * the return value as the fiber disposer. It serves no task board, which is the
 * deployment this case is about: the mount must still take exactly one seam.
 */
function context() {
  const labels: string[] = []
  const disposers: Array<() => void> = []
  const ctx = {
    effect: (callback: () => unknown, label?: string) => {
      if (label !== undefined) labels.push(label)
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
      return dispose
    },
    on: () => () => {},
    // No board service on this page: the dependency scope is registered and
    // simply never mounts. The shape matches cordis's: a fiber with a dispose.
    inject: () => ({ dispose: () => {} }),
  }
  return { ctx, labels, disposers }
}

describe('task-board GitHub extension configuration', () => {
  it('operator leaving the extension unconfigured gets the documented defaults', () => {
    // Given a profile entry that declares no configuration at all
    // When the schema applies its defaults and the plugin reads them
    const resolved = Config({})
    const settings = resolveProviderSettings(resolved)
    // Then the extension is on, silent, and reads the standard credential
    // reference with no repository configured
    expect(readConfigField(resolved.enabled, false)).toBe(true)
    expect(readConfigField(resolved.announceToAgent, true)).toBe(false)
    expect(settings.tokenEnv).toBe(DEFAULT_TOKEN_ENV)
    expect(settings.repositories).toEqual([])
  })

  it('operator toggling the switch after activation is followed without a remount', () => {
    // Given a mounted row whose master switch the Loader commits in place
    let live = true
    const mounted = { ...Config({}), enabled: { get: () => live } }
    // When the switch flips off after the activation captured its config
    live = false
    // Then the effective settings report the live value, not the capture
    expect(resolveProviderSettings(mounted as never).enabled).toBe(false)
  })

  it('operator mounting the same package twice keeps one lifecycle, released by its disposer', () => {
    // Given an enabled profile entry mounted once
    const harness = context()
    apply(harness.ctx as never, Config({ enabled: true }))
    // When the same package name mounts a second time (aggregate row plus a standalone link)
    apply(harness.ctx as never, Config({ enabled: true }))
    // Then the refused mount queued instead of registering a second lifecycle
    expect(harness.labels).toEqual(['task-board-github: provider lifecycle'])
    // And releasing the holder lets the next mount take the seam again
    for (const dispose of harness.disposers.splice(0)) dispose()
    apply(harness.ctx as never, Config({ enabled: true }))
    expect(harness.labels).toEqual([
      'task-board-github: provider lifecycle',
      'task-board-github: provider lifecycle',
    ])
  })

  it('operator opening the settings page gets every field served as live-editable', () => {
    // Given the Config schema the Host serves as this entry's settings page
    const dict = (Config as unknown as { dict?: Record<string, { meta?: { volatile?: boolean } }> }).dict ?? {}
    // When every schema node is read
    // Then all of them are volatile: the Host's settings surface serves
    // volatile fields only, so a field without the marker cannot be written
    // from the settings card, the setup routes or an agent tool at all, and a
    // volatile write reaches the running provider without a row reload.
    for (const [field, node] of Object.entries(dict)) {
      expect(node.meta?.volatile, field).toBe(true)
    }
    expect(Object.keys(dict).sort()).toEqual(['announceToAgent', 'enabled', 'repositories', 'tokenEnv'])
  })

  it('operator reading the published package identity gets the bundle this patch names', () => {
    // Given the package identity the host guard keys on
    // When the bundle name is compared with the patch row's own name
    // Then the two agree, so an aggregate and a standalone install dedupe
    expect(PACKAGE_NAME).toBe('@linxin666/dsh-client-ui-task-board-github')
  })
})
