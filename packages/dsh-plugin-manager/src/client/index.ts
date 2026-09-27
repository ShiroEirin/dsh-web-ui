/**
 * Plugin-manager browser half: contributes the package's one remaining
 * surface — the check-for-updates block on the official Plugins page — and
 * provides the dual-channel face as the `'pluginManager'` cordis service for
 * sibling client plugins.
 *
 * It is dual-channel: on runtimes with the official installer services
 * (DSHCode, the 1.0.4 checkout web) every operation rides the official
 * `/plugin-installer` and `/plugin-control` loopback RPC channels (the single
 * writer); on the npm-published web runtime those channels do not exist, so the
 * same face falls back to this package's own loopback HTTP gateway, which
 * spawns the official CLI for writes. Neither the patch nor service consumers
 * know which mode the face runs in.
 *
 * The package used to register its own "Plugin manager" tab into the official
 * Plugins settings section (`settings.plugins.tab`). Installing, uninstalling
 * and enabling moved to the official page long ago, and the tab's remaining
 * half was UI no official page renders; the tab is gone and its one genuinely
 * missing capability — comparing an installed plugin against its registry
 * source, with the DSH-runtime compatibility gate — now renders inside the
 * official page through the `plugins.detail.section` seat it declares.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots, the
// registry this package registers its contribution into).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { PluginUpdatePatch, type PluginUpdatePatchInjected } from './PluginUpdatePatch.tsx'
import { en, zh, type PluginManagerKey } from './locales.ts'
import {
  parseFailuresSnapshot,
  parseInstallStatus,
  parseInstalledPlugin,
  parsePluginList,
  parseUpdateList,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginFailuresSnapshot,
  type PluginUpdateItem,
} from '../core/protocol.ts'
import { PLUGIN_MANAGER_SERVICE, type PluginManagerService } from '../core/service.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the check-for-updates patch. */
    'settings.pluginManager': PluginManagerKey
  }
}

const NS = 'settings.pluginManager'
const CHANNEL = '/plugin-installer'
const LIST_ENDPOINT = 'list'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const CHECK_UPDATES_ENDPOINT = 'check-updates'
const STATUS_ENDPOINT = 'status'
const FAILURES_ENDPOINT = 'failures'

// DOCUMENT-RELATIVE (issue #1707): the GUI is served with `<base href="./">`,
// so a sub-path deployment resolves the gateway prefix against its entry
// directory rather than the origin root.
const GATEWAY_PREFIX = 'api/plugin-manager'
/** Gateway job polling cadence. */
const JOB_POLL_MS = 500
/** Gateway job wait ceiling (the host add deadline is six minutes). */
const JOB_WAIT_MS = 7 * 60_000

/** Services required by the patch registration and both channels. */
export const inject = ['slots', 'locale', 'connection']

/** The gateway job wire shape served by /status. */
interface GatewayJobWire {
  phase: 'running' | 'done' | 'error'
  plugin?: unknown
  error?: string
}

/**
 * The face the update patch and the `'pluginManager'` cordis service share:
 * the patch's wire surface plus the cross-plugin service contract. The gateway
 * host still records install conflicts and boot failures; no client surface
 * consumes either since the tab left, so neither is on this face.
 */
export type PluginManagerFace = PluginUpdatePatchInjected & PluginManagerService

/**
 * Build the dual-channel face once: official-channel and gateway-channel
 * implementations, the mode detection that picks between them, and the
 * change-notification listener set. The returned face is both the update
 * patch's injected props and the value provided as the
 * `'pluginManager'` cordis service.
 * @param ctx - the client context (connection).
 * @returns the shared face.
 */
export function createPluginManagerFace(ctx: ClientContext): PluginManagerFace {
  const connection = ctx.get('connection') as ConnectionHandle

  // Official channel implementations.

  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new Error(`plugin-installer ${endpoint} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const official = {
    list: async (): Promise<InstalledPluginItem[]> => parsePluginList(await call(LIST_ENDPOINT, {})),
    install: async (spec: string): Promise<InstalledPluginItem> => parseInstalledPlugin(await call(INSTALL_ENDPOINT, { spec })),
    update: async (id: string): Promise<InstalledPluginItem> => parseInstalledPlugin(await call(UPDATE_ENDPOINT, { id })),
    uninstall: async (id: string): Promise<InstalledPluginItem[]> => parsePluginList(await call(UNINSTALL_ENDPOINT, { id })),
    setEnabled: async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
      parseInstalledPlugin(await call(SET_ENABLED_ENDPOINT, { id, enabled })),
    checkUpdates: async (): Promise<PluginUpdateItem[]> => parseUpdateList(await call(CHECK_UPDATES_ENDPOINT, {})),
    status: async (): Promise<InstallProgressItem> => parseInstallStatus(await call(STATUS_ENDPOINT, {})),
    failures: async (): Promise<PluginFailuresSnapshot> => parseFailuresSnapshot(await call(FAILURES_ENDPOINT, {})),
  }

  // Gateway channel implementations.

  const gatewayJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
    if (response.status === 403) {
      throw new Error('plugin-manager: plugin management is only available from a local browser')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `plugin-manager: gateway ${path} failed: HTTP ${String(response.status)}`)
    }
    return response.json()
  }

  /** Wait for one gateway job to settle, returning its wire state. */
  const waitJob = async (jobId: string): Promise<GatewayJobWire> => {
    const deadline = Date.now() + JOB_WAIT_MS
    for (;;) {
      const body = await gatewayJson(`${GATEWAY_PREFIX}/status?job=${encodeURIComponent(jobId)}`) as { job?: GatewayJobWire }
      const job = body.job
      if (job === undefined) throw new Error('plugin-manager: gateway job vanished')
      if (job.phase === 'done') return job
      if (job.phase === 'error') throw new Error(job.error ?? 'plugin-manager: gateway job failed')
      if (Date.now() > deadline) throw new Error('plugin-manager: gateway job timed out')
      await new Promise(resolve => { setTimeout(resolve, JOB_POLL_MS) })
    }
  }

  /** Whether a gateway install/remove is in flight (drives the progress row). */
  let gatewayInflight = false

  const gateway = {
    list: async (): Promise<InstalledPluginItem[]> =>
      parsePluginList(await gatewayJson(`${GATEWAY_PREFIX}/list`)),
    install: async (spec: string): Promise<InstalledPluginItem> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/install`, {
          method: 'POST',
          body: JSON.stringify({ spec }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway install returned no job')
        const job = await waitJob(started.jobId)
        return parseInstalledPlugin({ plugin: job.plugin })
      } finally {
        gatewayInflight = false
      }
    },
    update: async (id: string): Promise<InstalledPluginItem> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/update`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway update returned no job')
        const job = await waitJob(started.jobId)
        return parseInstalledPlugin({ plugin: job.plugin })
      } finally {
        gatewayInflight = false
      }
    },
    uninstall: async (id: string): Promise<InstalledPluginItem[]> => {
      gatewayInflight = true
      try {
        const started = await gatewayJson(`${GATEWAY_PREFIX}/remove`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        }) as { jobId?: string }
        if (started.jobId === undefined) throw new Error('plugin-manager: gateway remove returned no job')
        await waitJob(started.jobId)
        return gateway.list()
      } finally {
        gatewayInflight = false
      }
    },
    setEnabled: async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
      parseInstalledPlugin(await gatewayJson(`${GATEWAY_PREFIX}/set-enabled`, {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      })),
    checkUpdates: async (): Promise<PluginUpdateItem[]> =>
      parseUpdateList(await gatewayJson(`${GATEWAY_PREFIX}/check-updates`)),
    status: async (): Promise<InstallProgressItem> =>
      gatewayInflight ? { kind: 'install', stage: 'download' } : { kind: 'idle', stage: 'fetch' },
    failures: async (): Promise<PluginFailuresSnapshot> =>
      parseFailuresSnapshot(await gatewayJson(`${GATEWAY_PREFIX}/failures`)),
  }

  // Mode selection.

  let modePromise: Promise<'official' | 'gateway'> | undefined
  const ensureMode = (): Promise<'official' | 'gateway'> => {
    if (modePromise === undefined) {
      modePromise = (async () => {
        // Prefer the host verdict: the gateway's /mode route reports whether
        // the official installer channels exist, so the direct channel probe
        // below (which 405s into the browser console on the npm web runtime)
        // only runs when the host half is absent or explicitly returns null
        // for a desktop runtime whose services are registered in-process.
        try {
          const mode = await gatewayJson(`${GATEWAY_PREFIX}/mode`) as { official?: boolean | null }
          if (mode.official === true) return 'official' as const
          if (mode.official === false) return 'gateway' as const
        } catch {
          // Host half absent (an official runtime without a boot profile):
          // fall back to the direct channel probe.
        }
        try {
          const result = await connection.rpc.call(CHANNEL, LIST_ENDPOINT, {})
          return result.ok ? 'official' as const : 'gateway' as const
        } catch {
          return 'gateway' as const
        }
      })()
    }
    return modePromise
  }

  // Change notification.

  /** Listeners subscribed through onChange; fired after successful mutations. */
  const listeners = new Set<() => void>()
  /** Notify every listener; one listener throwing never breaks the others. */
  const notifyChange = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A consumer's listener failure is its own; keep notifying the rest.
      }
    }
  }

  // The shared face.

  return {
    isLoopback: connection.isLoopback,
    list: async () => (await ensureMode()) === 'official' ? official.list() : gateway.list(),
    install: async spec => {
      const item = await ((await ensureMode()) === 'official' ? official.install(spec) : gateway.install(spec))
      notifyChange()
      return item
    },
    update: async id => {
      const item = await ((await ensureMode()) === 'official' ? official.update(id) : gateway.update(id))
      notifyChange()
      return item
    },
    uninstall: async id => {
      const rows = await ((await ensureMode()) === 'official' ? official.uninstall(id) : gateway.uninstall(id))
      notifyChange()
      return rows
    },
    setEnabled: async (id, enabled) => {
      const item = await ((await ensureMode()) === 'official' ? official.setEnabled(id, enabled) : gateway.setEnabled(id, enabled))
      notifyChange()
      return item
    },
    checkUpdates: async () => (await ensureMode()) === 'official' ? official.checkUpdates() : gateway.checkUpdates(),
    status: async () => (await ensureMode()) === 'official' ? official.status() : gateway.status(),
    failures: async () => (await ensureMode()) === 'official' ? official.failures() : gateway.failures(),
    onChange: cb => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
}

/** Contribute the check-for-updates patch and provide the shared face. */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-plugin-manager' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'plugin-manager: dictionaries')

  // Built once: the patch and the 'pluginManager' cordis service share one
  // face, so consumers observe exactly the mutations the patch performs.
  const face = createPluginManagerFace(ctx)
  try {
    if (!ctx.get(PLUGIN_MANAGER_SERVICE)) {
      ctx.provide(PLUGIN_MANAGER_SERVICE, face)
    }
  } catch {
    // ignore duplicate provide
  }

  // The official Plugins page declares this seat on its main-panel entry and
  // renders one section per contribution on each bundle / row / plugin page;
  // `inject` waits for that declaration, exactly like the family plugin cards
  // that register into `plugins.bundle.config`.
  ctx.slots.inject('plugins.detail.section', () => {
    try {
      return ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'family-update-check',
        order: 30,
        locale: NS,
        inject: () => face,
      }, PluginUpdatePatch)
    } catch {
      return () => {}
    }
  })
}
