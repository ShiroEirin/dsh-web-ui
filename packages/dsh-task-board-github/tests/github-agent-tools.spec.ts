/**
 * The GitHub-specific task-board agent tools. These are the model-visible
 * surface of the integration, contributed by the provider through the board's
 * registerTool capability rather than by the board's own agent-tools module, so
 * each case asserts what the model can observe through a tool call.
 */
import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'
import { GitHubApiClient } from '../src/host/client.ts'
import { GitHubSyncService } from '../src/host/service.ts'
import { buildGitHubTools } from '../src/host/tools.ts'
import { FakeBoard } from './support/fake-board.ts'
import { FakeGitHubBackend, issueFixture } from './support/fake-github.ts'

/** Admit a stub provider and hand back the capability face the board gives it. */
function faceOf(board: FakeBoard): TaskBoardExtensionHost {
  let face: TaskBoardExtensionHost | undefined
  const stub: TaskBoardExtension = { id: 'github', apiVersion: 1, start: host => { face = host } }
  board.admit(stub)
  if (face === undefined) throw new Error('the fake board did not start the provider')
  return face
}

/** One GitHub-backed card payload, as a synchronized card would carry it. */
function githubIntegration(owner: string, repository: string, issueNumber: number): Record<string, unknown> {
  return {
    github: {
      provider: 'github',
      owner,
      repository,
      issueNumber,
      issueUrl: `https://github.com/${owner}/${repository}/issues/${String(issueNumber)}`,
      remoteLabels: ['dsh'],
      remoteState: 'open',
    },
  }
}

/** Locate one registered tool by name; a missing tool is a wiring failure. */
function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} is not registered`)
  return tool
}

/** Run one tool with the given arguments and return its structured result. */
async function runTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return await tool.execute(args, {} as never) as Record<string, unknown>
}

describe('GitHub agent tools', () => {
  it('operator sees the seven GitHub tools contributed by the provider alone', () => {
    // Given a board holding no GitHub card and a provider with no repository
    const board = new FakeBoard()
    const service = new GitHubSyncService({ host: faceOf(board), repositories: [] })

    // When the provider's tool set is read
    const names = buildGitHubTools(service).map(tool => tool.name)

    // Then it contributes exactly its seven narrowly-scoped tools
    expect(names).toEqual([
      'task_board_github_list',
      'task_board_github_get',
      'task_board_github_refresh',
      'task_board_github_create_pr',
      'task_board_github_link_pr',
      'task_board_github_comment',
      'task_board_github_close_issue',
    ])
  })

  it('operator lists only GitHub-backed cards and can narrow by owner or remote state', async () => {
    // Given a board holding one plain card and two GitHub-backed cards
    const board = new FakeBoard()
    board.seed({ id: 'task-plain', title: 'Plain task' })
    board.seed({ id: 'task-gh-1', title: 'dsh issue 1', integrations: githubIntegration('deepseek-ai', 'dsh', 1) })
    const closed = githubIntegration('other-org', 'other-repo', 2)
    ;(closed.github as Record<string, unknown>).remoteState = 'closed'
    board.seed({ id: 'task-gh-2', title: 'other issue 2', integrations: closed })

    const service = new GitHubSyncService({ host: faceOf(board), repositories: [] })
    const listTool = findTool(buildGitHubTools(service), 'task_board_github_list')

    // When the model lists them unfiltered, then by owner, then by state
    const all = await runTool(listTool, {})
    const byOwner = await runTool(listTool, { owner: 'deepseek-ai' })
    const byState = await runTool(listTool, { state: 'closed' })

    // Then the plain card is never included and each filter narrows correctly
    expect((all.tasks as unknown[]).length).toBe(2)
    expect((byOwner.tasks as Array<{ taskId: string }>).length).toBe(1)
    expect((byOwner.tasks as Array<{ taskId: string }>)[0]?.taskId).toBe('task-gh-1')
    expect((byState.tasks as Array<{ taskId: string }>).length).toBe(1)
    expect((byState.tasks as Array<{ taskId: string }>)[0]?.taskId).toBe('task-gh-2')
  })

  it('operator reads one GitHub card by task id or by repository and issue number', async () => {
    // Given a board holding one GitHub-backed card
    const board = new FakeBoard()
    board.seed({ id: 'task-10', title: 'dsh issue 10', integrations: githubIntegration('deepseek-ai', 'dsh', 10) })
    const service = new GitHubSyncService({ host: faceOf(board), repositories: [] })
    const getTool = findTool(buildGitHubTools(service), 'task_board_github_get')

    // When the model looks it up by task id, then by the stable triple, then by a missing id
    const byId = await runTool(getTool, { taskId: 'task-10' })
    const byTriple = await runTool(getTool, { owner: 'deepseek-ai', repository: 'dsh', issueNumber: 10 })
    const missing = await runTool(getTool, { taskId: 'non-existent' })

    // Then the same card answers both lookups and an unknown id is refused
    expect(byId.ok).toBe(true)
    expect((byId.task as { title: string }).title).toBe('dsh issue 10')
    expect((byId.task as { github: { issueNumber: number } }).github.issueNumber).toBe(10)
    expect(byTriple.ok).toBe(true)
    expect((byTriple.task as { taskId: string }).taskId).toBe('task-10')
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('not-found')
  })

  it('operator creates and links a pull request only through the configured repository', async () => {
    // Given a configured repository whose branch list and PR endpoints answer deterministically
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [{
      number: 40,
      title: 'PR Tool Task',
      body: 'Task for PR tool testing',
      state: 'open',
      html_url: 'https://github.com/deepseek-ai/dsh/issues/40',
      labels: ['dsh'],
      updated_at: '2026-09-02T10:00:00Z',
    }]
    backend.branches = ['feature/pr-40']
    backend.pulls = [{
      number: 99,
      html_url: 'https://github.com/deepseek-ai/dsh/pull/99',
      state: 'open',
      head: { ref: 'existing-branch' },
      base: { ref: 'main' },
    }]

    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }],
    })
    board.seed({ id: 'task-40', title: 'dsh issue 40', integrations: githubIntegration('deepseek-ai', 'dsh', 40) })

    const tools = buildGitHubTools(service)
    const createPrTool = findTool(tools, 'task_board_github_create_pr')
    const linkPrTool = findTool(tools, 'task_board_github_link_pr')
    const refreshTool = findTool(tools, 'task_board_github_refresh')

    // When the model asks for a PR on a branch that does not exist remotely
    const branchMissing = await runTool(createPrTool, { taskId: 'task-40', headBranch: 'missing-branch' })
    // Then the operation is refused with the domain reason
    expect(branchMissing.ok).toBe(false)
    expect(branchMissing.code).toBe('branch-not-found')

    // When it asks again on a branch that does exist
    const created = await runTool(createPrTool, { taskId: 'task-40', headBranch: 'feature/pr-40' })
    // Then a PR is created (the stand-in numbers it after the one PR it
    // already holds) and reported
    expect(created.ok).toBe(true)
    expect((created.pullRequest as { number: number }).number).toBe(2)

    // When it links an existing PR by number
    const linked = await runTool(linkPrTool, { taskId: 'task-40', pullRequestNumber: 99 })
    // Then that PR is attached to the card
    expect(linked.ok).toBe(true)
    expect((linked.pullRequest as { number: number }).number).toBe(99)

    // When it refreshes the card from GitHub
    const refreshed = await runTool(refreshTool, { taskId: 'task-40' })
    // Then the refresh is accepted
    expect(refreshed.ok).toBe(true)
  })

  it('operator posts a completion comment on the issue behind a card', async () => {
    // Given a card linked to a configured repository's issue
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }],
    })
    board.seed({ id: 'task-50', title: 'dsh issue 50', integrations: githubIntegration('deepseek-ai', 'dsh', 50) })
    const commentTool = findTool(buildGitHubTools(service), 'task_board_github_comment')

    // When the model reports what it did
    const posted = await runTool(commentTool, { taskId: 'task-50', body: 'Fixed in #7; the parser now rejects a trailing slash.' })

    // Then the comment reaches the issue verbatim and its URL comes back
    expect(posted.ok).toBe(true)
    expect(backend.comments).toEqual([{ issueNumber: 50, body: 'Fixed in #7; the parser now rejects a trailing slash.' }])
    expect((posted.comment as { url: string }).url).toContain('issuecomment-')

    // And an empty body is refused rather than posted as a blank comment
    const empty = await runTool(commentTool, { taskId: 'task-50', body: '   ' })
    expect(empty.ok).toBe(false)
    expect(backend.comments).toHaveLength(1)

    // And a body past the length ceiling is refused instead of truncated into
    // something the model did not write
    const huge = await runTool(commentTool, { taskId: 'task-50', body: 'x'.repeat(16_001) })
    expect(huge.ok).toBe(false)
    expect(backend.comments).toHaveLength(1)
  })

  it('operator closing an issue is gated on a merged pull request', async () => {
    // Given a card whose pull request is still open
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(60, ['dsh'])]
    backend.pulls = [{
      number: 9,
      html_url: 'https://github.com/deepseek-ai/dsh/pull/9',
      state: 'open',
      head: { ref: 'feature' },
      base: { ref: 'dev' },
    }]
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }],
    })
    const integration = githubIntegration('deepseek-ai', 'dsh', 60)
    ;(integration.github as Record<string, unknown>).pullRequest = { number: 9, url: 'https://github.com/deepseek-ai/dsh/pull/9', state: 'open' }
    board.seed({ id: 'task-60', title: 'dsh issue 60', integrations: integration })
    const closeTool = findTool(buildGitHubTools(service), 'task_board_github_close_issue')

    // When the model asks to close it while the PR is open
    const refused = await runTool(closeTool, { taskId: 'task-60' })

    // Then the issue stays open and the refusal names the real reason
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('pr-not-merged')
    expect(backend.stateOf(60)).toBe('open')

    // And once the PR is merged, closing succeeds
    backend.pulls[0]!.state = 'closed'
    backend.pulls[0]!.merged = true
    const closed = await runTool(closeTool, { taskId: 'task-60' })
    expect(closed.ok).toBe(true)
    expect(closed.state).toBe('closed')
    expect(backend.stateOf(60)).toBe('closed')
  })

  it('operator closing a card with no pull request is refused', async () => {
    // Given a card that never opened one
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(70, ['dsh'])]
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }],
    })
    board.seed({ id: 'task-70', title: 'dsh issue 70', integrations: githubIntegration('deepseek-ai', 'dsh', 70) })
    const closeTool = findTool(buildGitHubTools(service), 'task_board_github_close_issue')

    // When the model asks to close it
    const refused = await runTool(closeTool, { taskId: 'task-70' })

    // Then it is refused: a local run is not merged work
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('no-linked-pr')
    expect(backend.stateOf(70)).toBe('open')
  })

  it('operator refreshing an unconfigured board is refused instead of hitting GitHub', async () => {
    // Given a provider configured with no repository at all
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = new GitHubSyncService({
      host: faceOf(board),
      client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
      repositories: [],
    })
    const refreshTool = findTool(buildGitHubTools(service), 'task_board_github_refresh')

    // When the model asks for a refresh
    const result = await runTool(refreshTool, {})

    // Then it is refused with a diagnosable reason and no request leaves the process
    expect(result.ok).toBe(false)
    expect(result.code).toBe('not-configured')
    expect(backend.requests).toBe(0)
  })
})
