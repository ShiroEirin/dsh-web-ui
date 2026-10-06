/**
 * The optional host workspace registry, resolved structurally.
 *
 * The extension must mount on a deployment that serves no workspace registry
 * at all, so the service is probed rather than injected: an absent, malformed
 * or throwing registry simply means no card gets a workspace pin, which is the
 * behavior this extension had before workspace inference existed.
 *
 * @module dsh-task-board-github/host/workspace-registry
 */
import type { WorkspaceRegistryFace } from './service.ts'

/** The name the host serves its workspace registry under. */
const WORKSPACE_REGISTRY_SERVICE = 'workspaceRegistry'

/**
 * Resolve the host workspace registry from a context-like object.
 *
 * Only list() is demanded. The board's own registry face is exactly that, and
 * accepting a wider surface here would let an unrelated service masquerade as
 * a workspace registry.
 *
 * @param ctx - anything exposing a context-like getter.
 * @returns the registry, or undefined when this deployment serves none.
 */
export function probeWorkspaceRegistry(ctx: { get(name: string): unknown }): WorkspaceRegistryFace | undefined {
  let service: unknown
  try {
    service = ctx.get(WORKSPACE_REGISTRY_SERVICE)
  } catch {
    return undefined
  }
  if (typeof service !== 'object' || service === null) return undefined
  if (typeof (service as { list?: unknown }).list !== 'function') return undefined
  return service as WorkspaceRegistryFace
}
