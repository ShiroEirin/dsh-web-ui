/**
 * Host-side write access to this extension's own settings entry.
 *
 * The repository list is configuration, not a private store: it lives in the
 * harness settings document under this extension's namespace, which is also
 * what the profile patch and the settings card address. The Host's settings
 * surface only accepts fields the Config schema marks `volatile()`, so this
 * module (and the tools and routes built on it) writes the list back through
 * that surface with the revision it just read, and the Loader commits the new
 * value into the running fiber without a restart.
 *
 * The read half deliberately goes through the live config the Host handed this
 * plugin — it already carries the merged base (profile patch) and user layers
 * with schema defaults applied — while the write half has to name the entry id
 * the settings surface knows, which is why the id is discovered from
 * `describe()` instead of being assumed.
 *
 * @module dsh-task-board-github/host/configuration
 */
import type { Context } from '@deepseek-ai/cordis'
import { GITHUB_ENTRY_IDS } from '../core/setup.ts'
import type { GitHubRepoConfig } from '../core/types.ts'

/** One entry the settings surface reports. */
interface SettingsDescriptor {
  ns?: unknown
  value?: unknown
  revision?: unknown
}

/** One path-addressed edit the settings surface accepts. */
type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** The slice of the Host settings surface this extension uses. */
export interface SettingsFace {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/**
 * Resolve the optional settings service. A deployment that serves none keeps
 * the extension running; only configuration writes are refused.
 * @param ctx - host context.
 * @returns the surface, or undefined.
 */
export function resolveSettingsFace(ctx: Context): SettingsFace | undefined {
  try {
    const get = (ctx as { get?: (name: string) => unknown }).get
    if (typeof get !== 'function') return undefined
    const face = get.call(ctx, 'settings') as SettingsFace | undefined
    if (face === undefined) return undefined
    return typeof face.describe === 'function' && typeof face.mutate === 'function' ? face : undefined
  } catch {
    return undefined
  }
}

/**
 * Find this extension's own entry in the settings surface.
 * @param face - the settings surface.
 * @returns the entry id and its current revision, or undefined when this
 *   deployment serves no form for this extension.
 */
export function findGitHubSettingsEntry(face: SettingsFace): { ns: string; revision: number } | undefined {
  let descriptors: SettingsDescriptor[]
  try {
    descriptors = face.describe({ redactSecrets: true })
  } catch {
    return undefined
  }
  for (const wanted of GITHUB_ENTRY_IDS) {
    const hit = descriptors.find(descriptor => descriptor.ns === wanted)
    if (hit !== undefined) {
      const revision = typeof hit.revision === 'number' ? hit.revision : 0
      return { ns: wanted, revision }
    }
  }
  return undefined
}

/**
 * Replace the configured repository list.
 *
 * The write is a single path op against the entry's own revision: a
 * concurrent settings edit is refused by the surface rather than overwritten
 * from a stale view.
 * @param ctx - host context.
 * @param repositories - the sanitized list to store.
 * @throws when this deployment serves no settings form for this extension, or
 *   the surface refuses the write.
 */
export async function writeConfiguredRepositories(ctx: Context, repositories: readonly GitHubRepoConfig[]): Promise<void> {
  const face = resolveSettingsFace(ctx)
  if (face === undefined) throw new Error('this deployment serves no settings surface, so the repository list cannot be written')
  if (face.writable === false) throw new Error('this deployment serves configuration read-only')
  const entry = findGitHubSettingsEntry(face)
  if (entry === undefined) throw new Error('this deployment exposes no settings form for the GitHub extension')
  await face.mutate(entry.ns, [{ op: 'set', path: ['repositories'], value: repositories }], entry.revision)
}
