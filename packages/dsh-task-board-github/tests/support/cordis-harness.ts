/**
 * Real cordis contexts for the extension's wiring tests.
 *
 * The provider wiring hangs off the board's `taskBoard` service, and the bug
 * these helpers exist to catch is a REGISTRY race: the Host and the aggregate
 * both load the board's row and this one in an order this package does not own,
 * so the service may be published after this extension's own apply. A
 * hand-written context double can only prove what the double was told, so these
 * helpers build a real `@deepseek-ai/cordis` root and drive the real
 * `provide` / `inject` / fiber lifecycle.
 *
 * @module tests/support/cordis-harness
 */
import { Context } from '@deepseek-ai/cordis'
import type {
  TaskBoardClientFace,
  TaskBoardClientMirror,
  TaskBoardVisibilityPredicate,
} from '../../src/core/contract.ts'

/**
 * Let cordis's fiber transitions settle.
 *
 * Nothing about a plugin load is synchronous: `Fiber._reload` awaits
 * `Promise.resolve()` before the callback runs, and an injected scope mounts
 * and unloads through the same path. The default turn count covers a load, an
 * unload and the nested awaits inside them.
 * @param turns - microtask turns to yield.
 */
export async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

/**
 * Mount one plugin apply in its own fiber, the way the Host mounts a row.
 * @param root - the real context to mount under.
 * @param mount - the apply, handed the fiber's own context.
 * @returns a handle that unloads the mount.
 */
export async function mountPlugin(
  root: Context,
  mount: (ctx: Context) => void,
): Promise<{ ctx: Context; dispose(): Promise<void> }> {
  let mounted: Context | undefined
  const fiber = root.plugin((ctx: Context) => {
    mounted = ctx
    mount(ctx)
  })
  await settle()
  if (mounted === undefined) throw new Error('the mount did not run')
  return {
    ctx: mounted,
    dispose: async () => {
      await fiber.dispose()
      await settle()
    },
  }
}

/** A board client face that records the predicates and mirror pushes. */
export interface RecordingClientFace {
  face: TaskBoardClientFace
  /** Visibility predicates currently registered. */
  visibility: TaskBoardVisibilityPredicate[]
  /** Whether the board's own master switch reports on. */
  isEnabled(): boolean
  /** Apply the board's own master switch and push a mirror update. */
  setEnabled(next: boolean): void
  /** Publish this extension's summary and push a mirror update. */
  publish(summary: Record<string, unknown>): void
}

/**
 * Build a recording board client face.
 * @returns the face and what it observed.
 */
export function recordingClientFace(): RecordingClientFace {
  const visibility: TaskBoardVisibilityPredicate[] = []
  const listeners = new Set<(mirror: TaskBoardClientMirror) => void>()
  let enabled = true
  let extensions: Record<string, unknown> = {}
  const face: TaskBoardClientFace = {
    dispatch: async () => true,
    registerVisibility(predicate) {
      visibility.push(predicate)
      return () => {
        const index = visibility.indexOf(predicate)
        if (index !== -1) visibility.splice(index, 1)
      }
    },
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    snapshot: () => ({ enabled, tasks: [], extensions }),
  }
  const notify = (): void => {
    for (const listener of [...listeners]) listener(face.snapshot())
  }
  return {
    face,
    visibility,
    isEnabled: () => enabled,
    setEnabled: (next) => { enabled = next; notify() },
    publish: (summary) => { extensions = { ...extensions, github: summary }; notify() },
  }
}

/** A slot registry that records what a viewer registers. */
export interface RecordingSlots {
  service: { register(options: Record<string, unknown>, component: unknown): () => void }
  /** Seat registrations currently held. */
  seats: Array<Record<string, unknown>>
}

/**
 * Build a recording slot registry.
 * @returns the service and the seats it holds.
 */
export function recordingSlots(): RecordingSlots {
  const seats: Array<Record<string, unknown>> = []
  return {
    seats,
    service: {
      register(options: Record<string, unknown>) {
        seats.push(options)
        return () => {
          const index = seats.indexOf(options)
          if (index !== -1) seats.splice(index, 1)
        }
      },
    },
  }
}
