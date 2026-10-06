/**
 * Pure projection and lifecycle mapping for the GitHub provider.
 *
 * These cases pin the two contracts the integration exists to keep honest:
 * only DSH-owned labels are ever written back to GitHub, and a stored provider
 * payload that no longer matches the provider's shape is treated as absent
 * rather than crashing the provider.
 *
 * Content immutability is no longer decided here: reconciliation always
 * proposes the remote content, and the board's own gate refuses the patch on a
 * card that has started executing. That half is covered by the sync-service
 * cases, which drive the gate for real.
 */
import { describe, expect, it } from 'vitest'
import {
  computeLabelWriteBack,
  isDshManagedLabel,
  isIssueIncluded,
  issueAssignees,
  materializeTaskFromIssue,
  reconcileIssueWithTask,
  resolveStatusFromLabels,
} from '../src/core/projection.ts'
import { fingerprint } from '../src/core/prompt.ts'
import {
  normalizeGitHubMetadata,
  readTaskGitHubMetadata,
  resolveRepoConfig,
  type GitHubIssuePayload,
  type ResolvedGitHubRepoConfig,
} from '../src/core/types.ts'
import { plainTask } from './support/fake-board.ts'

const sampleConfig: ResolvedGitHubRepoConfig = resolveRepoConfig({
  owner: 'deepseek-ai',
  repository: 'dsh',
  inclusionLabel: 'dsh',
  managedLabelPrefix: 'dsh:',
  prPhaseLabel: 'dsh:phase:pr',
})

/** One remote issue payload carrying the given labels and body. */
function remoteIssue(overrides: Partial<GitHubIssuePayload> = {}): GitHubIssuePayload {
  return {
    number: 101,
    title: 'Issue 101',
    body: 'Body',
    state: 'open',
    html_url: 'https://github.com/deepseek-ai/dsh/issues/101',
    labels: ['bug', 'dsh'],
    updated_at: '2026-09-02T12:00:00Z',
    ...overrides,
  }
}

describe('GitHub issue inclusion', () => {
  it('operator includes an issue by its label or by assignment, and only those two channels', () => {
    // Given a repository configured for both channels, with the assignee
    // already resolved to a concrete login
    const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh', assignee: 'zhu1090093659' })

    // When each shape of issue is tested
    // Then label-only, assignee-only and both are in, and neither one is out
    expect(isIssueIncluded(remoteIssue({ labels: ['dsh'] }), config)).toBe(true)
    expect(isIssueIncluded(remoteIssue({ labels: ['bug'], assignees: [{ login: 'Zhu1090093659' }] }), config)).toBe(true)
    expect(isIssueIncluded(remoteIssue({ labels: ['dsh'], assignees: [{ login: 'zhu1090093659' }] }), config)).toBe(true)
    expect(isIssueIncluded(remoteIssue({ labels: ['bug'], assignees: [{ login: 'someone-else' }] }), config)).toBe(false)
    expect(isIssueIncluded(remoteIssue({ labels: [], assignees: [] }), config)).toBe(false)
  })

  it('operator taking unassigned issues collects the ones nobody owns, and still leaves other people\'s alone', () => {
    // Given a repository whose issues are never assigned to anyone
    const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh', assignee: 'zhu1090093659', includeUnassigned: true })

    // When an unassigned issue and an issue assigned to someone else are tested
    // Then the unassigned one is in, and the other person\'s assignment is
    // still not ours to take
    expect(isIssueIncluded(remoteIssue({ labels: ['bug'], assignees: [] }), config)).toBe(true)
    expect(isIssueIncluded(remoteIssue({ labels: ['bug'], assignees: [{ login: 'someone-else' }] }), config)).toBe(false)
    // And the other two channels keep working alongside it
    expect(isIssueIncluded(remoteIssue({ labels: ['dsh'] }), config)).toBe(true)
    expect(isIssueIncluded(remoteIssue({ labels: [], assignees: [{ login: 'Zhu1090093659' }] }), config)).toBe(true)
  })

  it('operator leaving the unassigned channel off imports no unassigned issue', () => {
    // Given a repository configured with only the label and assignee channels
    const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh', assignee: 'zhu1090093659' })

    // When the resolved default and an unassigned issue are read
    // Then the channel defaults to off, so that issue stays out
    expect(config.includeUnassigned).toBe(false)
    expect(isIssueIncluded(remoteIssue({ labels: ['bug'], assignees: [] }), config)).toBe(false)
  })

  it('operator reading assignees from either payload shape gets lowercased logins', () => {
    // Given payloads carrying user objects and bare strings
    // When the assignees are read
    // Then both shapes resolve and empty entries are dropped
    expect(issueAssignees(remoteIssue({ assignees: [{ login: 'Zhu' }] }))).toEqual(['zhu'])
    expect(issueAssignees(remoteIssue({ assignees: ['Aa728848', ''] }))).toEqual(['aa728848'])
    expect(issueAssignees(remoteIssue({ assignees: null }))).toEqual([])
  })

  it('operator leaving @me unresolved imports nothing by assignment, because the host resolves it first', () => {
    // Given a configuration still carrying the placeholder
    const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh', assignee: '@me' })

    // When an issue assigned to the account is tested
    // Then the placeholder matches no login: only the host's substitution can
    expect(isIssueIncluded(remoteIssue({ labels: [], assignees: [{ login: 'zhu1090093659' }] }), config)).toBe(false)
  })

  it('operator keeping an issue assigned to the configured login keeps its card active with no label', () => {
    // Given a card whose issue carries no inclusion label but is assigned here
    const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh', assignee: 'zhu1090093659' })
    const issue = remoteIssue({ number: 5, labels: ['bug'], assignees: [{ login: 'zhu1090093659' }] })

    // When it is reconciled
    const task = reconcileIssueWithTask(plainTask('task-assigned'), issue, 200, config)

    // Then the card is not deactivated
    expect(readTaskGitHubMetadata(task)?.deactivated).toBeUndefined()
  })
})

describe('GitHub projection and label management', () => {
  it('operator sees DSH-owned labels recognized and the inclusion label left alone', () => {
    // Given a repository whose managed prefix, state labels and PR phase label are configured
    // When each label is classified for DSH ownership
    // Then the managed ones are owned, and the inclusion label is not, so write-back
    // never removes the very label that selects the issue
    expect(isDshManagedLabel('dsh:state:todo', sampleConfig)).toBe(true)
    expect(isDshManagedLabel('dsh:state:done', sampleConfig)).toBe(true)
    expect(isDshManagedLabel('dsh:phase:pr', sampleConfig)).toBe(true)
    expect(isDshManagedLabel('dsh:custom', sampleConfig)).toBe(true)
    expect(isDshManagedLabel('bug', sampleConfig)).toBe(false)
    expect(isDshManagedLabel('security', sampleConfig)).toBe(false)
    expect(isDshManagedLabel('priority:high', sampleConfig)).toBe(false)
    expect(isDshManagedLabel('dsh', sampleConfig)).toBe(false)
  })

  it('operator moving a card writes back only DSH-owned labels and leaves repository labels intact', () => {
    // Given an issue carrying repository labels, the inclusion label and a stale state label
    const current = ['bug', 'security', 'dsh', 'dsh:state:todo', 'priority:high']

    // When the card moves to done
    const { labelsToAdd, labelsToRemove } = computeLabelWriteBack(current, 'done', false, sampleConfig)

    // Then only the DSH state label changes, and the repository labels are never touched
    expect(labelsToRemove).toEqual(['dsh:state:todo'])
    expect(labelsToAdd).toEqual(['dsh:state:done'])
    expect(labelsToRemove).not.toContain('bug')
    expect(labelsToRemove).not.toContain('security')
    expect(labelsToRemove).not.toContain('priority:high')
    expect(labelsToRemove).not.toContain('dsh')
  })

  it('operator with an active pull request sees the PR phase label added and removed with the PR', () => {
    // Given an issue whose card is running with no PR yet
    const current = ['bug', 'dsh', 'dsh:state:todo']

    // When the PR becomes active
    const withPr = computeLabelWriteBack(current, 'running', true, sampleConfig)

    // Then both the state label and the PR phase label are added
    expect(withPr.labelsToAdd).toContain('dsh:state:running')
    expect(withPr.labelsToAdd).toContain('dsh:phase:pr')

    // When the PR settles, the phase label and the stale state label are removed
    const prActiveLabels = ['bug', 'dsh', 'dsh:state:running', 'dsh:phase:pr']
    const prSettled = computeLabelWriteBack(prActiveLabels, 'done', false, sampleConfig)
    expect(prSettled.labelsToRemove).toContain('dsh:state:running')
    expect(prSettled.labelsToRemove).toContain('dsh:phase:pr')
    expect(prSettled.labelsToAdd).toEqual(['dsh:state:done'])
  })

  it('operator importing an issue sees its remote state project onto a board column', () => {
    // Given issues carrying various remote states and DSH state labels
    // When each is projected into the local board
    // Then the remote closed state and the managed state labels decide the column
    expect(resolveStatusFromLabels(['bug', 'dsh'], 'open', sampleConfig)).toBe('todo')
    expect(resolveStatusFromLabels(['bug', 'dsh:state:backlog'], 'open', sampleConfig)).toBe('backlog')
    expect(resolveStatusFromLabels(['dsh:state:failed'], 'open', sampleConfig)).toBe('failed')
    expect(resolveStatusFromLabels(['dsh:state:done'], 'open', sampleConfig)).toBe('done')
    expect(resolveStatusFromLabels(['bug'], 'closed', sampleConfig)).toBe('done')
  })

  it('operator importing an issue gets a card carrying the full provider metadata', () => {
    // Given a GitHub issue carrying the inclusion label and some repository labels
    const issue = remoteIssue({
      number: 42,
      node_id: 'I_node123',
      title: 'Fix issue 42',
      body: 'Detailed description of fix',
      labels: ['dsh', 'dsh:state:todo', 'component:ui'],
      updated_at: '2026-09-02T10:00:00Z',
      html_url: 'https://github.com/deepseek-ai/dsh/issues/42',
    })

    // When it is materialized as a card
    const task = materializeTaskFromIssue(issue, 'task-uuid', 100, sampleConfig)

    // Then the card carries the stable identity and the remote metadata
    expect(task.id).toBe('task-uuid')
    expect(task.title).toBe('Fix issue 42')
    expect(task.description).toBe('Detailed description of fix')
    // And its execution prompt is the template: the issue reference, the
    // workflow, and the body verbatim inside the provenance wrap
    expect(task.prompt).toContain('GitHub issue deepseek-ai/dsh#42')
    expect(task.prompt).toContain('task_board_github_comment')
    expect(task.prompt).toContain('ISSUE 原文 开始')
    expect(task.prompt).toContain('Detailed description of fix')
    expect(task.status).toBe('todo')
    expect(task.integrations?.github).toEqual({
      provider: 'github',
      owner: 'deepseek-ai',
      repository: 'dsh',
      issueNumber: 42,
      issueNodeId: 'I_node123',
      issueUrl: 'https://github.com/deepseek-ai/dsh/issues/42',
      remoteTitle: 'Fix issue 42',
      remoteBody: 'Detailed description of fix',
      remoteState: 'open',
      remoteLabels: ['dsh', 'dsh:state:todo', 'component:ui'],
      lastSyncedAt: 100,
      lastRemoteUpdatedAt: Date.parse('2026-09-02T10:00:00Z'),
      promptHash: fingerprint(task.prompt),
    })
  })

  it('operator importing an issue with many labels is not truncated by the native tag limit', () => {
    // Given an issue carrying more labels than the native 8-tag limit allows
    const manyLabels = Array.from({ length: 12 }, (_, index) => `label-${String(index + 1)}`)
    const issue = remoteIssue({ number: 99, title: 'Many labels', body: '', labels: manyLabels })

    // When it is materialized as a card
    const task = materializeTaskFromIssue(issue, 'task-many-labels', 100, sampleConfig)

    // Then every remote label is retained as provider metadata, and none of them
    // leaked into the native tag list (which is what carries promptPrefix)
    expect(readTaskGitHubMetadata(task)?.remoteLabels).toHaveLength(12)
    expect(task.tags).toBeUndefined()
  })

  it('operator sees a reconciled card propose the remote content it read', () => {
    // Given a card whose local text has drifted from the issue
    const existing = plainTask('task-1', { title: 'Old Title', description: 'Old Desc', prompt: 'Old Prompt' })

    // When the issue is reconciled against it
    const reconciled = reconcileIssueWithTask(
      existing,
      remoteIssue({ number: 101, title: 'New Remote Title', body: 'New Remote Body' }),
      20,
      sampleConfig,
    )

    // Then the proposal carries the remote content, and the board's own gate
    // decides whether a frozen card keeps its recorded values
    expect(reconciled.title).toBe('New Remote Title')
    expect(reconciled.description).toBe('New Remote Body')
    expect(reconciled.prompt).toContain('GitHub issue deepseek-ai/dsh#101')
    expect(reconciled.prompt).toContain('New Remote Body')
    expect(readTaskGitHubMetadata(reconciled)?.remoteTitle).toBe('New Remote Title')
    expect(readTaskGitHubMetadata(reconciled)?.issueNumber).toBe(101)
    expect(readTaskGitHubMetadata(reconciled)?.lastSyncedAt).toBe(20)
  })

  it('operator removing the inclusion label keeps the task and its identity until it returns', () => {
    // Given an imported card whose issue carries the inclusion label
    const task = plainTask('task-1')

    // When the label is removed remotely
    const deactivated = reconcileIssueWithTask(task, remoteIssue({ labels: ['bug'] }), 20, sampleConfig)

    // Then the item is deactivated rather than deleted, and keeps its identity
    expect(readTaskGitHubMetadata(deactivated)?.deactivated).toBe(true)
    expect(deactivated.id).toBe('task-1')

    // And when the label is added back, the same card is restored
    const restored = reconcileIssueWithTask(deactivated, remoteIssue({ labels: ['bug', 'dsh'] }), 30, sampleConfig)
    expect(readTaskGitHubMetadata(restored)?.deactivated).toBeUndefined()
    expect(restored.id).toBe('task-1')
  })

  it('operator sees a malformed stored payload dropped while a valid one is repaired', () => {
    // Given corrupted and whitespace-padded provider metadata
    // When each is normalized
    // Then unusable entries are dropped and the valid one is trimmed
    expect(normalizeGitHubMetadata(null)).toBeUndefined()
    expect(normalizeGitHubMetadata({})).toBeUndefined()
    expect(normalizeGitHubMetadata({ provider: 'gitlab' })).toBeUndefined()

    const valid = normalizeGitHubMetadata({
      provider: 'github',
      owner: '  deepseek-ai ',
      repository: ' dsh ',
      issueNumber: 15,
      issueUrl: 'https://github.com/deepseek-ai/dsh/issues/15',
      remoteLabels: ['dsh', 'bug'],
      pullRequest: {
        number: 200,
        url: 'https://github.com/deepseek-ai/dsh/pull/200',
        state: 'open',
        draft: true,
        headBranch: 'feat/test',
      },
    })

    expect(valid?.owner).toBe('deepseek-ai')
    expect(valid?.repository).toBe('dsh')
    expect(valid?.issueNumber).toBe(15)
    expect(valid?.pullRequest?.number).toBe(200)
    expect(valid?.pullRequest?.draft).toBe(true)
    expect(valid?.pullRequest?.headBranch).toBe('feat/test')
  })
})
