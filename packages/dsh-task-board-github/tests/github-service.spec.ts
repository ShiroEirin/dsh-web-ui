/**
 * The provider's synchronization loop, driven against an in-process GitHub
 * stand-in and the contract-level fake board. Each case drives the real
 * GitHubSyncService and then reads the board (or the fake remote) back, so the
 * assertions are about what an operator ends up with rather than about internal
 * calls.
 */
import { describe, expect, it } from 'vitest'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'
import type { HostTimerFace } from '../src/core/timers.ts'
import type { TaskRecord } from '../src/core/task-record.ts'
import { readTaskGitHubMetadata, type GitHubRepoConfig } from '../src/core/types.ts'
import { GitHubApiClient } from '../src/host/client.ts'
import { GitHubSyncService } from '../src/host/service.ts'
import { FakeBoard, recordingTimers, withExecution } from './support/fake-board.ts'
import { FakeGitHubBackend, issueFixture, json } from './support/fake-github.ts'

/** The repository every case configures. */
const REPO: GitHubRepoConfig = { owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }

/** Admit a stub provider and hand back the capability face the board gives it. */
function faceOf(board: FakeBoard): TaskBoardExtensionHost {
  let face: TaskBoardExtensionHost | undefined
  const stub: TaskBoardExtension = { id: 'github', apiVersion: 1, start: host => { face = host } }
  board.admit(stub)
  if (face === undefined) throw new Error('the fake board did not start the provider')
  return face
}

/** One service wired to the fake board, a GitHub stand-in and a fixed clock. */
function makeService(
  board: FakeBoard,
  backend: FakeGitHubBackend,
  options: { repositories?: GitHubRepoConfig[]; now?: () => number; timers?: HostTimerFace; token?: string; workspaces?: Array<{ id: string, path?: string, name?: string }> } = {},
): GitHubSyncService {
  return new GitHubSyncService({
    host: faceOf(board),
    client: new GitHubApiClient({ token: options.token ?? 'test-token', fetch: backend.fetch }),
    repositories: options.repositories ?? [REPO],
    now: options.now ?? (() => 100),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.workspaces === undefined
      ? {}
      : { workspaceRegistry: () => ({ list: () => options.workspaces ?? [] }) }),
  })
}

/** Every card the fake board currently holds, in insertion order. */
function cards(board: FakeBoard): TaskRecord[] {
  return [...board.records.values()]
}

describe('GitHub sync service', () => {
  it('operator sees an issue carrying the inclusion label imported once and reconciled on every later sync', async () => {
    // Given a repository with one includable issue and one that lacks the label
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(10, ['dsh', 'bug'], 'Issue 10 description'), issueFixture(11, ['feature'])]
    const service = makeService(board, backend)

    // When the repository is synchronized
    const first = await service.syncRepository('deepseek-ai', 'dsh')

    // Then only the labeled issue is materialized, carrying its remote metadata
    expect(first.synced).toBe(1)
    expect(cards(board)).toHaveLength(1)
    const task = cards(board)[0]!
    expect(readTaskGitHubMetadata(task)?.issueNumber).toBe(10)
    expect(readTaskGitHubMetadata(task)?.remoteLabels).toEqual(['dsh', 'bug'])
    // And its GitHub labels never leak into the native tag list
    expect(task.tags).toBeUndefined()

    // When the same repository is synchronized again
    const second = await service.syncRepository('deepseek-ai', 'dsh')

    // Then the same card is reconciled rather than duplicated
    expect(second.synced).toBe(1)
    expect(cards(board)).toHaveLength(1)
    expect(cards(board)[0]?.id).toBe(task.id)
  })

  it('operator assigning an issue to the authenticated account imports it with no inclusion label', async () => {
    // Given a repository that also includes the account's assigned issues, a
    // remote that answers who this credential is, and two issues of which only
    // one is assigned to that account
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.login = 'zhu1090093659'
    backend.issues = [
      issueFixture(20, ['bug'], 'assigned to me', ['zhu1090093659']),
      issueFixture(21, ['bug'], 'assigned to someone else', ['Aa728848']),
    ]
    const service = makeService(board, backend, { repositories: [{ ...REPO, assignee: '@me' }] })

    // When the repository is synchronized
    const result = await service.syncRepository('deepseek-ai', 'dsh')

    // Then only the assigned issue became a card, so no label was needed
    expect(result.errors).toEqual([])
    expect(cards(board).map(card => readTaskGitHubMetadata(card)?.issueNumber)).toEqual([20])
  })

  it('operator unassigning the last channel deactivates the card without deleting it', async () => {
    // Given a card imported through the assignee channel
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.login = 'zhu1090093659'
    backend.issues = [issueFixture(30, ['bug'], '', ['zhu1090093659'])]
    const service = makeService(board, backend, { repositories: [{ ...REPO, assignee: '@me' }] })
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(readTaskGitHubMetadata(cards(board)[0]!)?.deactivated).toBeUndefined()

    // When the issue is reassigned away and no label carries it either
    backend.issues = [issueFixture(30, ['bug'], '', ['Aa728848'])]
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the card is deactivated but still on the board
    expect(cards(board)).toHaveLength(1)
    expect(readTaskGitHubMetadata(cards(board)[0]!)?.deactivated).toBe(true)
  })

  it('operator restarting the extension re-adopts the cards the board already holds', async () => {
    // Given a board already carrying a synchronized card (an earlier session,
    // or a legacy ledger import) and a brand-new service
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(10, ['dsh', 'bug'])]
    board.seed({
      id: 'task-existing',
      title: 'Issue 10',
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh',
          issueNumber: 10,
          issueUrl: 'https://github.com/deepseek-ai/dsh/issues/10',
          remoteLabels: ['dsh', 'bug'],
        },
      },
    })
    const service = makeService(board, backend)

    // When the provider starts and synchronizes
    service.start()
    await service.syncRepository('deepseek-ai', 'dsh')
    service.stop()

    // Then the stored card is adopted rather than duplicated
    expect(cards(board)).toHaveLength(1)
    expect(cards(board)[0]?.id).toBe('task-existing')
    expect(readTaskGitHubMetadata(cards(board)[0])?.issueNumber).toBe(10)
  })

  it('operator removing the inclusion label keeps the card and its execution history until it returns', async () => {
    // Given an imported card that has already run to success
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(25, ['dsh'])]
    const service = makeService(board, backend)
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!
    board.seed(withExecution(task, { id: 'exec-1', startedAt: 150, settledAt: 160, result: 'succeeded' }))

    // When the inclusion label is removed on GitHub and the repository is synchronized
    backend.issues[0]!.labels = ['some-other-label']
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the card is deactivated, not deleted, and its history survives
    const deactivated = board.records.get(task.id)
    expect(readTaskGitHubMetadata(deactivated)?.deactivated).toBe(true)
    expect(deactivated?.executions).toHaveLength(1)
    expect(deactivated?.executions[0]?.result).toBe('succeeded')

    // When the label is added back and the repository is synchronized again
    backend.issues[0]!.labels = ['dsh', 'some-other-label']
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the same card is restored with its history intact
    const restored = board.records.get(task.id)
    expect(readTaskGitHubMetadata(restored)?.deactivated).toBeUndefined()
    expect(restored?.executions).toHaveLength(1)
  })

  it('operator sees a card keep its execution prompt when the remote issue changes after the first run', async () => {
    // Given an imported card whose prompt came from the issue body
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(50, ['dsh'], 'Initial Prompt Content')]
    const service = makeService(board, backend)
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!
    const recorded = task.prompt
    expect(recorded).toContain('Initial Prompt Content')

    // And the card has started executing, which is what the board's content
    // gate freezes it on
    board.seed(withExecution(task, { id: 'exec-50', startedAt: 150 }))

    // When the remote title and body are edited on GitHub
    backend.issues[0]!.title = 'Changed Title'
    backend.issues[0]!.body = 'Changed Remote Body'
    backend.issues[0]!.updated_at = '2026-09-02T11:00:00Z'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the board refused the content patch: the recorded prompt and title
    // are unchanged while the remote snapshot is recorded as metadata only
    const stored = board.records.get(task.id)!
    expect(stored.prompt).toBe(recorded)
    expect(stored.prompt).not.toContain('Changed Remote Body')
    expect(stored.title).toBe('Issue 50')
    expect(readTaskGitHubMetadata(stored)?.remoteTitle).toBe('Changed Title')
    expect(readTaskGitHubMetadata(stored)?.remoteBody).toBe('Changed Remote Body')
  })

  it('operator moving a card writes back only DSH-owned labels and leaves repository labels alone', async () => {
    // Given an imported issue carrying repository labels
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(77, ['dsh', 'bug', 'priority:p0', 'team:core'])]
    const service = makeService(board, backend)
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!

    // When the card is moved to running
    await service.writeBackTaskStatus(task.id, 'running')

    // Then the DSH state label is added and every repository label survives
    const running = backend.labelsOf(77)
    expect(running).toContain('dsh:state:running')
    expect(running).toContain('bug')
    expect(running).toContain('priority:p0')
    expect(running).toContain('team:core')

    // When the card settles as done
    await service.writeBackTaskStatus(task.id, 'done')

    // Then the old state label is replaced and the repository labels are still untouched
    const done = backend.labelsOf(77)
    expect(done).toContain('dsh:state:done')
    expect(done).not.toContain('dsh:state:running')
    expect(done).toContain('bug')
    expect(done).toContain('priority:p0')
    expect(done).toContain('team:core')
  })

  it('operator keeps working locally while GitHub is unreachable, and the failure is reported', async () => {
    // Given a GitHub backend that times out
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.networkFailure = true
    const service = makeService(board, backend)

    // When a sync runs
    const result = await service.syncRepository('deepseek-ai', 'dsh')

    // Then the failure is reported back rather than thrown at the local runtime
    expect(result.synced).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('ETIMEDOUT')
  })

  it('operator creates a pull request only for a branch that already exists remotely', async () => {
    // Given an imported issue and a repository whose only remote branch is feature-88
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(88, ['dsh'], 'Implement PR')]
    backend.branches = ['feature-88']
    const service = makeService(board, backend)
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!

    // When a PR is requested for a branch that is not on the remote
    // Then the request is refused with the reason, and no PR is recorded
    await expect(service.createPullRequest(task.id, { headBranch: 'non-existent-branch' }))
      .rejects.toThrow('branch "non-existent-branch" does not exist on remote')
    expect(backend.pulls).toHaveLength(0)

    // When a PR is requested for the existing branch as a draft
    const pull = await service.createPullRequest(task.id, { headBranch: 'feature-88', draft: true })

    // Then the PR is created as a draft, recorded on the card, and the remote
    // issue picks up the PR phase label
    expect(pull.number).toBe(1)
    expect(pull.draft).toBe(true)
    expect(backend.labelsOf(88)).toContain('dsh:phase:pr')
    const updated = board.records.get(task.id)!
    expect(readTaskGitHubMetadata(updated)?.pullRequest?.number).toBe(1)
    expect(readTaskGitHubMetadata(updated)?.pullRequest?.state).toBe('open')
  })

  it('operator sees a merged pull request settle the card and close the issue when that policy is on', async () => {
    // Given a configured repository that closes the issue on merge, with a PR open
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(90, ['dsh'])]
    backend.branches = ['branch-90']
    const service = makeService(board, backend, { repositories: [{ ...REPO, closeIssueOnMerge: true }] })
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!
    await service.createPullRequest(task.id, { headBranch: 'branch-90' })

    // When the PR is merged on GitHub and the repository is synchronized
    backend.pulls[0]!.merged = true
    backend.pulls[0]!.state = 'closed'
    backend.pulls[0]!.merged_at = '2026-09-02T12:00:00Z'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the card records the merged PR, drops the PR phase label, gains the
    // done state label, and the issue is closed
    const settled = board.records.get(task.id)!
    expect(readTaskGitHubMetadata(settled)?.pullRequest?.state).toBe('merged')
    const labels = backend.labelsOf(90)
    expect(labels).not.toContain('dsh:phase:pr')
    expect(labels).toContain('dsh:state:done')
    expect(backend.stateOf(90)).toBe('closed')
    expect(readTaskGitHubMetadata(settled)?.remoteState).toBe('closed')
  })

  it('operator sees an abandoned pull request leave the issue open and the card reconciled', async () => {
    // Given a repository that closes the issue on merge, with a PR open
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(95, ['dsh'])]
    backend.branches = ['branch-95']
    const service = makeService(board, backend, { repositories: [{ ...REPO, closeIssueOnMerge: true }] })
    await service.syncRepository('deepseek-ai', 'dsh')
    const task = cards(board)[0]!
    await service.createPullRequest(task.id, { headBranch: 'branch-95' })

    // When the PR is closed without being merged
    backend.pulls[0]!.merged = false
    backend.pulls[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the card reports the closed PR while the issue stays open
    const settled = board.records.get(task.id)!
    expect(readTaskGitHubMetadata(settled)?.pullRequest?.state).toBe('closed')
    expect(backend.stateOf(95)).toBe('open')
    expect(readTaskGitHubMetadata(settled)?.remoteState).toBe('open')
  })

  it('operator deleting a synchronized card sees the next sync re-import it as a fresh card', async () => {
    // Given a synchronized card the operator then deletes
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(120, ['dsh'])]
    const service = makeService(board, backend)
    await service.syncRepository('deepseek-ai', 'dsh')
    const deleted = cards(board)[0]!
    board.emitTaskDeleted({ taskId: deleted.id })
    service.handleTaskDeleted(deleted.id)
    board.records.delete(deleted.id)

    // When the repository is synchronized again
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the issue comes back as a new card instead of addressing the dead one
    expect(cards(board)).toHaveLength(1)
    expect(cards(board)[0]?.id).not.toBe(deleted.id)
    expect(readTaskGitHubMetadata(cards(board)[0])?.issueNumber).toBe(120)
  })

  it('operator gets background polling on the configured interval, independent of the session heartbeat', () => {
    // Given a repository configured to poll every 60 seconds
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const recorder = recordingTimers()
    const service = makeService(board, backend, {
      repositories: [{ ...REPO, pollingIntervalMs: 60_000 }],
      timers: recorder.timers,
    })

    // When polling starts and then stops
    service.start()
    // Then the timer carries the configured interval, not the 5 s runtime heartbeat
    expect(recorder.armed).toEqual([{ kind: 'interval', delay: 60_000 }])
    service.stop()
    // And stopping releases the timer
    expect(recorder.cancelledCount()).toBe(1)
  })

  it('operator sees the GitHub summary report credential presence without ever carrying the token', () => {
    // Given a service holding a credential
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.fetch = async () => json([])
    const service = makeService(board, backend, { token: 'super-secret-token' })

    // When the summary the browser and the agent may read is produced
    const summary = service.snapshotSummary()

    // Then it reports that a credential exists and which repositories are
    // configured, and the token value appears nowhere in it
    expect(summary.hasCredential).toBe(true)
    expect(summary.repositories).toHaveLength(1)
    expect(summary.repositories[0]?.owner).toBe('deepseek-ai')
    expect(JSON.stringify(summary)).not.toContain('super-secret-token')
  })

  it('operator sees a synchronized issue pinned to the checkout of the same name', async () => {
    // Given a deployment holding two checkouts, one of which is this repository
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(80, ['dsh'])]
    const service = makeService(board, backend, {
      workspaces: [{ id: 'ws-dsh', path: '/home/dev/code/dsh' }, { id: 'ws-web', path: '/home/dev/code/dsh-web' }],
    })

    // When the sync materializes the card
    await service.syncAll()

    // Then it is pinned to the matching checkout, not to the most recent one
    const card = cards(board).find(candidate => readTaskGitHubMetadata(candidate)?.issueNumber === 80)
    expect(card?.workspaceId).toBe('ws-dsh')
  })

  it('operator whose checkout is named differently sees no pin rather than a wrong one', async () => {
    // Given a deployment whose checkouts do not match the repository name
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(81, ['dsh'])]
    const service = makeService(board, backend, {
      workspaces: [{ id: 'ws-a', path: '/home/dev/work/harness' }, { id: 'ws-b', path: '/home/dev/work/site' }],
    })

    // When the sync materializes the card
    await service.syncAll()

    // Then nothing is pinned: an unmatched repository keeps the board's own
    // inheritance rules instead of being sent to a lookalike project
    const card = cards(board).find(candidate => readTaskGitHubMetadata(candidate)?.issueNumber === 81)
    expect(card?.workspaceId).toBeUndefined()
  })

  it('operator with two checkouts of the same project sees no pin, because the choice is theirs', async () => {
    // Given an ambiguous deployment
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(82, ['dsh'])]
    const service = makeService(board, backend, {
      workspaces: [{ id: 'ws-one', path: '/home/dev/personal/dsh' }, { id: 'ws-two', path: '/home/dev/work/dsh' }],
    })

    // When the sync materializes the card
    await service.syncAll()

    // Then neither is chosen
    const card = cards(board).find(candidate => readTaskGitHubMetadata(candidate)?.issueNumber === 82)
    expect(card?.workspaceId).toBeUndefined()
  })

  it('operator on a deployment with no workspace registry is unaffected', async () => {
    // Given a service wired with no registry at all
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(83, ['dsh'])]
    const service = makeService(board, backend)

    // When the sync materializes the card
    await service.syncAll()

    // Then the card was still materialized, and it simply carries no pin
    const card = cards(board).find(candidate => readTaskGitHubMetadata(candidate)?.issueNumber === 83)
    expect([card?.title, card?.workspaceId]).toEqual(['Issue 83', undefined])
  })
})
