/**
 * Bridge to the two official surfaces the store reuses instead of re-implementing
 * plugin management:
 *
 * - `remote.pluginManager` — the official in-process plugin manager's client
 *   remote namespace. The API gateway registers every namespace as the service
 *   `remote.<namespace>`, and installing through it is the very call the
 *   official Plugins page makes, so the store needs no writer of its own and
 *   works on the packaged Desktop client, where the CLI refuses the
 *   application-owned profile.
 * - `pluginNavigation` — the reflect service the official Plugins page
 *   publishes; `openBundle(packageName)` opens that bundle's page in the
 *   official panel, which is where enablement, uninstall and install
 *   diagnostics already live.
 *
 * Both faces are OPTIONAL: when the running host publishes neither, the store
 * keeps its previous behaviour (the family `pluginManager` face, or the
 * read-only copy-command index).
 *
 * CONTRACT OBSERVATION: repository rules forbid cross-package value imports, so
 * the members this store calls are re-declared here. The `{ ok, value | error }`
 * envelope is the API gateway's own remote result, not a shape this package
 * invents.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Result envelope every `remote.<namespace>` method resolves with. */
export type NativeRemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string } }

/** The official in-process plugin manager's client remote namespace. */
export interface NativePluginManagerService {
  /**
   * Install (or update) one package spec through the official manager.
   * @param spec - package spec, e.g. `@scope/pkg` or `@scope/pkg@1.2.3`.
   * @param options - activation choice and the request id the run is tracked under.
   */
  installBundle(spec: string, options?: { enabled?: boolean; requestId?: string }): Promise<NativeRemoteResult<unknown>>
}

/** The official Plugins page's navigation face. */
export interface PluginNavigationService {
  /**
   * Open one installed bundle's page in the official Plugins panel.
   * @param packageName - installed dependency (package) name.
   */
  openBundle(packageName: string): void
}

/** Snapshot of the bridged native faces (null while the official surface is absent). */
export interface NativePluginFacesSnapshot {
  readonly manager: NativePluginManagerService | null
  readonly navigation: PluginNavigationService | null
  /** Bumped on every change, so consumers can detect same-reference swaps. */
  readonly version: number
}

let snapshot: NativePluginFacesSnapshot = { manager: null, navigation: null, version: 0 }
const listeners = new Set<() => void>()

/** Merge one face change into the snapshot and notify subscribers. */
function patchFaces(patch: { manager?: NativePluginManagerService | null; navigation?: PluginNavigationService | null }): void {
  snapshot = {
    manager: patch.manager === undefined ? snapshot.manager : patch.manager,
    navigation: patch.navigation === undefined ? snapshot.navigation : patch.navigation,
    version: snapshot.version + 1,
  }
  for (const listener of listeners) listener()
}

/** Current native-faces snapshot (cached reference, safe for useSyncExternalStore). */
export function getNativePluginFaces(): NativePluginFacesSnapshot {
  return snapshot
}

/** Subscribe to face changes; returns the unsubscribe function. */
export function subscribeNativePluginFaces(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Bridge both official faces into the module store. Uses ctx.inject (NOT the
 * plugin's module-level inject array) so each face stays optional: the inner
 * callback runs when the official plugin provides it and is disposed when it
 * goes away, which clears the store.
 * @param ctx - the client root context.
 */
export function bridgeNativePluginFaces(ctx: Context): void {
  ctx.inject(['remote.pluginManager'], (inner) => {
    inner.effect(() => {
      patchFaces({ manager: (inner.get('remote.pluginManager') as NativePluginManagerService | undefined) ?? null })
      return () => { patchFaces({ manager: null }) }
    }, 'dsh-web-ui-market: official pluginManager bridge')
  })
  ctx.inject(['pluginNavigation'], (inner) => {
    inner.effect(() => {
      patchFaces({ navigation: (inner.get('pluginNavigation') as PluginNavigationService | undefined) ?? null })
      return () => { patchFaces({ navigation: null }) }
    }, 'dsh-web-ui-market: official pluginNavigation bridge')
  })
}

/**
 * Install one spec through the official manager, surfacing a refusal as a
 * thrown error. The manager owns registry resolution, the profile lock and
 * bundle activation; this store only reports what it answered.
 * @param manager - the official remote face.
 * @param spec - validated install spec.
 * @param requestId - id the run is tracked under (also the UI's install key).
 */
export async function installViaOfficialManager(
  manager: NativePluginManagerService,
  spec: string,
  requestId: string,
): Promise<void> {
  const result = await manager.installBundle(spec, { enabled: true, requestId })
  if (result !== null && typeof result === 'object' && result.ok === false) {
    const error = (result as { error?: { code?: string; message?: string } }).error
    throw new Error(error?.message ?? error?.code ?? 'plugin-manager: official install failed')
  }
}
