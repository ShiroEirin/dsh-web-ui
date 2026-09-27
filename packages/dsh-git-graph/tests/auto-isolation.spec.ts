/**
 * Auto-isolation wrapper tests: fake workspaces/sessions services and a
 * stubbed GitApi verify the routing matrix — off passthrough, non-git
 * passthrough, no-nesting, worktree redirect, degradation on failure, and
 * shape-mismatch refusal.
 */
import { describe, expect, it, vi } from 'vitest'
import { installAutoIsolation } from '../src/client/auto-isolation.ts'
import type { GitApi } from '../src/client/api.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

const HOME = '/home/u/.dsh/worktrees'

interface FakeOptions {
  autoIsolate?: boolean
  statusNull?: boolean
  addFails?: boolean
  createFails?: boolean
}

/**
 * One fake client scope matching the 0.1.7 runtime split: the navigation
 * service (`uiWorkspace`) owns startSession, the registry (`workspaces`) owns
 * the rows, and the sessions list supplies the current session.
 */
function fakeScope(options: FakeOptions = {}) {
  const items = [
    { workspaceId: 'ws-main', path: '/repo', sessionIds: ['sess-1'] },
    { workspaceId: 'ws-wt', path: `${HOME}/repo-a1b2c3d4/s-abc`, sessionIds: [] },
  ]
  const startSession = vi.fn()
  const create = options.createFails
    ? vi.fn(async () => { throw new Error('registry full') })
    : vi.fn(async ({ path }: { path: string }) => ({ workspaceId: `ws-${path.split('/').pop()}` }))
  const navigation = { startSession }
  const workspaces = {
    create,
    list: {
      getSnapshot: () => ({ items, recentWorkspaceId: 'ws-main' }),
    },
  }
  const sessions = { list: { getSnapshot: () => ({ current: 'sess-1' as const, byId: {} }) } }
  const git = {
    config: vi.fn(async () => ({
      ok: true as const,
      value: {
        autoIsolate: options.autoIsolate ?? true,
        autoBaseline: 'current' as const,
        worktreesHome: HOME,
      },
    })),
    status: vi.fn(async () => options.statusNull === true
      ? { ok: true as const, value: null }
      : { ok: true as const, value: { branch: 'main' } }),
    addWorktree: options.addFails
      ? vi.fn(async () => ({ ok: false as const, error: { code: 'internal' as const, message: 'boom' } }))
      : vi.fn(async (_path: string, name: string) => ({
        ok: true as const,
        value: { path: `${HOME}/repo-a1b2c3d4/${name}`, branch: `wt/${name}`, name },
      })),
    removeWorktree: vi.fn(async () => ({ ok: true as const, value: { removed: true as const } })),
  }
  const scope = { uiWorkspace: navigation, workspaces, sessions } as unknown as ClientContext
  return { scope, navigation, workspaces, startSession, create, git }
}

/** Flush the wrapper's async routing (it returns void synchronously). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('installAutoIsolation', () => {
  it('passes through unchanged when autoIsolate is off', async () => {
    const { scope, navigation, startSession, git } = fakeScope({ autoIsolate: false })
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('passes through for non-git workspaces', async () => {
    const { scope, navigation, startSession, git } = fakeScope({ statusNull: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('redirects a git workspace new-session into a fresh worktree workspace', async () => {
    const { scope, navigation, startSession, create, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    expect(git.addWorktree).toHaveBeenCalledWith('/repo', expect.stringMatching(/^s-/), undefined)
    expect(create).toHaveBeenCalledWith({ path: expect.stringContaining(HOME) })
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession.mock.calls[0]?.[0]).toMatch(/^ws-/)
    expect(startSession.mock.calls[0]?.[0]).not.toBe('ws-main')
  })

  it('never nests: a workspace already under the managed home passes through', async () => {
    const { scope, navigation, startSession, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-wt')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-wt')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('degrades to the official behavior when worktree creation fails', async () => {
    const { scope, navigation, startSession } = fakeScope({ addFails: true })
    const { git } = fakeScope({ addFails: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('rolls back the worktree when workspace registration fails', async () => {
    const { scope, navigation, startSession, git } = fakeScope({ createFails: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    expect(git.removeWorktree).toHaveBeenCalledWith('/repo', expect.stringContaining(HOME), { force: true })
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('resolves the target from the current session when no workspaceId is given', async () => {
    const { scope, navigation, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession()
    await flush()
    // The current session sess-1 belongs to ws-main (/repo), a git workspace.
    expect(git.addWorktree).toHaveBeenCalledWith('/repo', expect.any(String), undefined)
  })

  it('creates one worktree when the new-session button is clicked twice quickly', async () => {
    const { scope, navigation, create, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    // Both clicks land before the first flow awaits, exactly like a double click.
    navigation.startSession('ws-main')
    navigation.startSession('ws-main')
    await flush()
    expect(git.addWorktree).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('accepts a later new-session click once the previous flow settled', async () => {
    const { scope, navigation, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    navigation.startSession('ws-main')
    await flush()
    navigation.startSession('ws-main')
    await flush()
    expect(git.addWorktree).toHaveBeenCalledTimes(2)
  })

  it('drops the registration and the worktree when starting the session throws', async () => {
    const { scope, navigation, startSession, git, workspaces } = fakeScope()
    const drop = vi.fn(async () => {})
    ;(workspaces as unknown as { delete?: unknown }).delete = drop
    installAutoIsolation(scope, git as unknown as GitApi)
    // The official call throws after the workspace row exists.
    startSession.mockImplementationOnce(() => { throw new Error('session start failed') })
    navigation.startSession('ws-main')
    await flush()
    expect(drop).toHaveBeenCalledWith(expect.stringMatching(/^ws-/))
    expect(git.removeWorktree).toHaveBeenCalledWith('/repo', expect.stringContaining(HOME), { force: true })
    // The fallback still starts the session in the original workspace.
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('keeps rolling back when the service exposes no registration removal', async () => {
    const { scope, navigation, startSession, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    startSession.mockImplementationOnce(() => { throw new Error('session start failed') })
    navigation.startSession('ws-main')
    await flush()
    expect(git.removeWorktree).toHaveBeenCalledWith('/repo', expect.stringContaining(HOME), { force: true })
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('refuses to wrap a shape-mismatched service and restores on dispose', async () => {
    const { scope, navigation, workspaces, startSession } = fakeScope()
    const sessions = (scope as unknown as { sessions: unknown }).sessions
    // Given a registry that lost its create verb (a client-runtime shape change).
    const brokenRegistry = { ...workspaces, create: 42 }
    const brokenScope = { uiWorkspace: navigation, workspaces: brokenRegistry, sessions } as unknown as ClientContext
    // When the wrapper installs.
    const disposer = installAutoIsolation(brokenScope, {} as GitApi)
    // Then it leaves the official startSession in place.
    expect(navigation.startSession).toBe(startSession)
    disposer()

    // And with both faces intact it wraps, then restores exactly on dispose.
    const good = installAutoIsolation(scope, {} as GitApi)
    expect(navigation.startSession).not.toBe(startSession)
    good()
    expect(navigation.startSession).toBe(startSession)
  })

  // #1690: the 0.1.7 split moved startSession off the registry service onto
  // uiWorkspace. Probing only the registry disabled the feature on every boot
  // and printed the shape warning on each page load, so the wrapper reads both
  // faces and only degrades when one is genuinely missing.
  it('operator: the split uiWorkspace/workspaces services carry the isolation flow', async () => {
    const { scope, navigation, startSession, git } = fakeScope()
    // Given the 0.1.7 faces: startSession on uiWorkspace, rows on workspaces.
    installAutoIsolation(scope, git as unknown as GitApi)
    // When a new session starts on a git workspace.
    navigation.startSession('ws-main')
    await flush()
    // Then the isolation flow runs and the wrapped startSession is in place.
    expect(git.addWorktree).toHaveBeenCalledWith('/repo', expect.any(String), undefined)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(navigation.startSession).not.toBe(startSession)
  })

  it('operator: a missing navigation face leaves the official start session untouched', async () => {
    const { scope, navigation, startSession, workspaces } = fakeScope()
    const sessions = (scope as unknown as { sessions: unknown }).sessions
    // Given a context without uiWorkspace at all.
    const legacy = { workspaces, sessions } as unknown as ClientContext
    // When the wrapper installs.
    const disposer = installAutoIsolation(legacy, {} as GitApi)
    // Then it refuses to wrap: the official method is the one still installed.
    expect(navigation.startSession).toBe(startSession)
    expect(startSession).not.toHaveBeenCalled()
    disposer()
  })
})