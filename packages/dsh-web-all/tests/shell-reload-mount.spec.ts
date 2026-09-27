/**
 * Family-row reload contract.
 *
 * A Host reload creates the new loader entries BEFORE the previous ones are
 * torn down: a plugin-manager enable/disable/install write, an HMR profile
 * reload, or a settings-driven row remount all land there. The aggregate shell
 * mounts its family plugin per entry, so the reloaded entry asks for the same
 * package name while the previous holder is still alive.
 *
 * Dropping that second mount silently cost the family plugin its host half for
 * the rest of the process: the previous entry then disposed its own mount,
 * freeing the name with nobody left to take it, while the family row stayed
 * listed as active, recorded no degraded entry, and served no host routes -
 * the task-board panel showed "后台接口没有挂载" until the Host restarted.
 * The guard now queues the refused mount and replays it on release.
 */
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/shell.ts'

/** The family plugin stand-in whose mount owns one host route. */
const FIXTURE_ROW = fileURLToPath(new URL('./fixtures/mount-once-row.ts', import.meta.url))

/** The route path that fixture row registers. */
const ROW_ROUTE = '/fixture-reload-row/state'

/** Minimal webServer service double recording exact routes by path. */
function webServerDouble(): { routes: Map<string, unknown>; register(route: { path: string }): () => void } {
  const routes = new Map<string, unknown>()
  return {
    routes,
    register(route: { path: string }) {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }
}

/** Flush the microtasks the mount handover defers its replay to. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('aggregate family row reload', () => {
  it('operator reloads the profile and the family row keeps serving its host route', async () => {
    // Given a live family row serving its host route
    const root = new Context()
    const webServer = webServerDouble()
    root.provide('webServer', webServer as never)
    const row = { plugin: FIXTURE_ROW }
    const previous = root.plugin(apply as never, row as never)
    await previous
    await settle()
    expect(webServer.routes.has(ROW_ROUTE)).toBe(true)

    // When the profile reloads and the new entry mounts while the old is alive
    const reloaded = root.plugin(apply as never, row as never)
    await reloaded
    await previous.dispose()
    await settle()

    // Then the row still serves its host route (the dropped-mount regression)
    expect(webServer.routes.has(ROW_ROUTE)).toBe(true)

    // And the last entry's disposal still tears the host half down
    await reloaded.dispose()
    await settle()
    expect(webServer.routes.has(ROW_ROUTE)).toBe(false)
  })
})
