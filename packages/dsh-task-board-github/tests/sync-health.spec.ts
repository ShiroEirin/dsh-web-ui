/**
 * Why a background sync that stops is now visible, and why it cannot wedge.
 *
 * These are the cases that were indistinguishable before: a configured,
 * credentialed, enabled integration that had silently synced nothing for hours
 * looked exactly like a healthy one, and a single request that never returned
 * killed every later poll on this host and on every restart of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubApiClient, GitHubTimeoutError } from '../src/host/client.ts'
import { GitHubSyncService } from '../src/host/service.ts'
import { FakeBoard } from './support/fake-board.ts'
import { FakeGitHubBackend, issueFixture } from './support/fake-github.ts'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'

/** Admit a stub provider and hand back the capability face the board gives it. */
function faceOf(board: FakeBoard): TaskBoardExtensionHost {
  let face: TaskBoardExtensionHost | undefined
  const stub: TaskBoardExtension = { id: 'github', apiVersion: 1, start: host => { face = host } }
  board.admit(stub)
  if (face === undefined) throw new Error('the fake board did not start the provider')
  return face
}

const REPO = { owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh', pollingIntervalMs: 300_000 }

describe('background sync health', () => {
  it('operator whose pass reached GitHub sees the instant it landed', async () => {
    // Given: a repository with one includable issue and a clock at 100
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(1, ['dsh'])]
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 't', fetch: backend.fetch }),
      repositories: [REPO],
      now: () => 100,
    })

    // When: a pass completes
    const result = await service.syncAll()

    // Then: the pass reports its work and health records the same instant
    expect([result.synced, result.errors]).toEqual([1, []])
    expect([service.syncHealth().lastSyncAt, service.syncHealth().lastErrors]).toEqual([100, []])
  })

  it('operator whose pass reported errors sees them instead of silence', async () => {
    // Given: a listing that always fails, so the error belongs to no card
    const board = new FakeBoard()
    const failing: typeof fetch = async () => new Response('nope', { status: 500 })
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 't', fetch: failing }),
      repositories: [REPO],
      now: () => 100,
    })

    // When: a pass completes
    await service.syncAll()

    // Then: the failure is retained where an operator can read it, and no
    // clean timestamp is claimed for a pass that reached nothing
    const health = service.syncHealth()
    expect(health.lastSyncAt).toBeUndefined()
    expect(health.lastErrors.length).toBeGreaterThan(0)
    expect(health.consecutiveEmptySyncs).toBe(1)
  })

  it('operator whose last clean pass is old is told the sync is stale', async () => {
    // Given: one clean pass at t=100, then a clock far past three intervals
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(1, ['dsh'])]
    let now = 100
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 't', fetch: backend.fetch }),
      repositories: [REPO],
      now: () => now,
    })
    await service.syncAll()

    // When: four poll intervals pass with no further clean pass
    now = 100 + 300_000 * 4

    // Then: health names the instant it went stale, instead of only a number
    // the operator has to compare against a remembered interval
    const health = service.syncHealth()
    expect([health.staleSince, health.staleAfterMs]).toEqual([100, 900_000])
  })

  it('operator whose pass is wedged mid-flight still gets the next poll', async () => {
    // Given: a service whose first pass never settles
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(1, ['dsh'])]
    let now = 100
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 't', fetch: backend.fetch }),
      repositories: [REPO],
      now: () => now,
    })
    // The guard is held by a pass that resolves never; only the timestamp
    // distinguishes it from a pass genuinely in flight.
    const wedged = service.syncAll()
    void wedged.catch(() => {})
    now = 100 + 300_000

    // When: the next interval fires after the guard went stale
    const next = await service.syncAll()

    // Then: it runs instead of returning at the first line, and a wedged
    // earlier pass cannot stop polling for the life of the process
    expect(next.synced).toBe(1)
    void wedged
  })

  it('operator sees health on the published summary, not only in memory', async () => {
    // Given: a mounted provider that published its summary once
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(1, ['dsh'])]
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 't', fetch: backend.fetch }),
      repositories: [REPO],
      now: () => 100,
    })

    // When: the summary the board and the settings card read is taken
    const summary = service.snapshotSummary()

    // Then: it carries health, so a stalled integration cannot look configured
    expect([summary.hasCredential, summary.health.lastErrors]).toEqual([true, []])
    expect(summary.health.running).toBe(true)
  })
})

describe('credential timing', () => {
  it('operator whose store is not up yet at activation still syncs on the next pass', async () => {
    // Given: a credential store that answers nothing on the first read — the
    // start-order race — and the real token afterwards
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(1, ['dsh'])]
    let reads = 0
    const service = new GitHubSyncService({
      host: faceOf(board),
      // No ambient token: the only credential is the one the seam hands over.
      client: new GitHubApiClient({ token: undefined, env: {} , fetch: backend.fetch }),
      repositories: [REPO],
      now: () => 100,
      credential: async () => {
        reads += 1
        return reads === 1 ? undefined : 'live-token'
      },
    })

    // When: the first pass runs before the store is serving, and the second
    // after it is
    const first = await service.syncAll()
    const second = await service.syncAll()

    // Then: the first reports the missing credential once rather than once per
    // repository, and the second authenticates on its own
    expect([first.synced, first.errors.length]).toEqual([0, 1])
    expect(second.synced).toBe(1)
    expect(service.syncHealth().lastSyncAt).toBe(100)
  })

  it('operator with no credential anywhere sees one reason, not one per repository', async () => {
    // Given: three repositories and a seam that never yields a token
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: undefined, env: {}, fetch: backend.fetch }),
      repositories: [REPO, { ...REPO, repository: 'other' }, { ...REPO, repository: 'third' }],
      now: () => 100,
      credential: async () => undefined,
    })

    // When: a pass runs
    const result = await service.syncAll()

    // Then: one cause is named once, and it says where the store was looked up
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('no GitHub API credential available')
    expect(result.errors[0]).toContain('deepseek-ai/dsh')
    expect(service.syncHealth().lastSyncAt).toBeUndefined()
  })
})

describe('request ceiling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('operator whose endpoint never answers gets a timeout instead of a stall', async () => {
    // Given: a fetch that never settles, as a dropped TCP connection does
    vi.useFakeTimers()
    const hanging: typeof fetch = () => new Promise<Response>(() => {})
    const client = new GitHubApiClient({ token: 't', fetch: hanging, requestTimeoutMs: 25 })

    // When: a request is made and the clock reaches the ceiling
    const attempt = client.getAuthenticatedUser().then(() => 'answered', (error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30)
    const outcome = await attempt

    // Then: it fails with a timeout the caller can tell from an API refusal,
    // instead of leaving the await pending and the poll locked behind it
    expect(outcome).toBeInstanceOf(GitHubTimeoutError)
  })

  it('operator whose request exceeds the ceiling is bounded by it', async () => {
    // Given: a fetch the endpoint has not answered yet, released by hand
    vi.useFakeTimers()
    let release: (value: Response) => void = () => {}
    const slow: typeof fetch = () => new Promise<Response>(resolve => { release = resolve })
    const client = new GitHubApiClient({ token: 't', fetch: slow, requestTimeoutMs: 25 })

    // When: the clock passes the ceiling while the endpoint is still silent
    const attempt = client.getAuthenticatedUser().then(() => 'answered', () => 'rejected')
    await vi.advanceTimersByTimeAsync(30)
    const settled = await attempt

    // And only then does the endpoint answer
    release(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await Promise.resolve()

    // Then: the ceiling decided, not the endpoint: the late answer changes
    // nothing, which is what keeps a pass from waiting on a dead socket
    expect(settled).toBe('rejected')
  })
})
