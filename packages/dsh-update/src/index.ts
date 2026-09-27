/**
 * dsh-update — host half. Mounts the /api/update route family on the web
 * server: the npm registry probe behind GET /api/update/status and the
 * profile's real `pnpm update --latest` behind POST /api/update/run. Both are
 * loopback-only control endpoints; the browser half (`./client`) renders the
 * sidebar trigger and the panel and reaches these routes over relative
 * same-origin /api paths.
 *
 * This capability is deliberately its own plugin row rather than a seat of
 * dsh-remote-web-ui: turning remote access off — or disabling that plugin —
 * must never take the update trigger away.
 */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from './loopback.ts'
import { mountOnce } from './mount-once.ts'
import {
  checkUpdates,
  fetchGitHubReleaseNotes,
  fetchLatestVersion,
  RELEASE_NOTES_CACHE_TTL_MS,
  resolveAnchorManifest,
  resolveUpdateTarget,
  runUpdateVerified,
  type UpdateReleaseNotes,
  type UpdateRunResult,
} from './update.ts'
import { makeUpdateRoutes } from './update-routes.ts'

/** Cordis plugin name of the host half. */
export const name = 'dsh-update'

/** Services required by this plugin. */
export const inject = ['webServer']

/**
 * How long one update-status probe answer is reused. The probe fans out one
 * registry GET per family package plus a GitHub call, and the sidebar update
 * entry asks for the status on every GUI page load.
 */
const UPDATE_STATUS_TTL_MS = 60_000

/**
 * Host body: probe the npm registry for family releases and run
 * `pnpm update --latest` in the owning profile. Resolutions anchor on the
 * host process's own module graph, so the update always targets the profile
 * the running web GUI was booted from. The anchor path is re-resolved per
 * operation: pnpm removes the old version's .pnpm directory on update, so a
 * boot-time captured path would fail to read after a successful update;
 * versions are re-read from disk per check.
 * @param ctx - host plugin context carrying the web server.
 */
export const apply = mountOnce('@linxin666/dsh-update', (ctx: Context): void => {
  const requireFromHost = createRequire(import.meta.url)
  /** Host-process resolve that degrades to "not installed" (undefined) instead of throwing. */
  const hostResolve = (specifier: string): string | undefined => {
    try {
      return requireFromHost.resolve(specifier)
    } catch {
      return undefined
    }
  }
  const resolveAnchorPath = (): string | undefined => resolveAnchorManifest(hostResolve)

  const releaseNotesCache = new Map<string, { at: number; notes?: UpdateReleaseNotes }>()
  const fetchReleaseNotesCached = async (version: string): Promise<UpdateReleaseNotes | undefined> => {
    const cached = releaseNotesCache.get(version)
    if (cached !== undefined && Date.now() - cached.at < RELEASE_NOTES_CACHE_TTL_MS) return cached.notes
    const notes = await fetchGitHubReleaseNotes(version, fetch)
    releaseNotesCache.set(version, { at: Date.now(), notes })
    return notes
  }
  // The status probe fans out one registry GET per family package (plus a
  // GitHub release-notes call), and the sidebar update entry asks for it on
  // every GUI page load — so the answer is memoized briefly and concurrent
  // callers share one probe. A completed update invalidates it.
  let updateStatusCache: { at: number; value: Awaited<ReturnType<typeof checkUpdates>> } | undefined
  let updateStatusInFlight: Promise<Awaited<ReturnType<typeof checkUpdates>>> | undefined
  const checkStatusCached = (): Promise<Awaited<ReturnType<typeof checkUpdates>>> => {
    const cached = updateStatusCache
    if (cached !== undefined && Date.now() - cached.at < UPDATE_STATUS_TTL_MS) return Promise.resolve(cached.value)
    if (updateStatusInFlight !== undefined) return updateStatusInFlight
    updateStatusInFlight = checkUpdates({
      anchorManifestPath: resolveAnchorPath(),
      resolve: hostResolve,
      fetchLatest: name => fetchLatestVersion(name, fetch),
      fetchReleaseNotes: fetchReleaseNotesCached,
    }).then((value) => {
      updateStatusCache = { at: Date.now(), value }
      return value
    }).finally(() => { updateStatusInFlight = undefined })
    return updateStatusInFlight
  }
  const routes = makeUpdateRoutes({
    // Control endpoints are host-surface only: a LAN/phone origin must never
    // trigger a real install on this machine.
    fence: isLoopbackRequest,
    check: () => checkStatusCached(),
    run: async (): Promise<UpdateRunResult> => {
      const target = resolveUpdateTarget({ anchorManifestPath: resolveAnchorPath() })
      if ('error' in target) {
        const code = target.error
        return {
          ok: false,
          exitCode: null,
          output: '',
          error: code === 'not-found' ? 'dsh-web aggregate not installed' : 'local link install — update unavailable',
          errorCode: code,
        }
      }
      // Verify the versions actually moved after a green pnpm exit: the pnpm
      // 11 minimumReleaseAge gate can silently keep the installed versions
      // (same-day releases), which a plain exit-0 check would report as
      // success — the user then restarts and nothing changed.
      const result = await runUpdateVerified({
        run: { profileDir: target.profileDir, packages: target.packages },
        check: {
          anchorManifestPath: resolveAnchorPath(),
          resolve: hostResolve,
          fetchLatest: name => fetchLatestVersion(name, fetch),
          fetchReleaseNotes: fetchReleaseNotesCached,
        },
      })
      // The install moved (or failed) the versions the cached status reported.
      updateStatusCache = undefined
      return result
    },
  })
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-update: update routes')
})
