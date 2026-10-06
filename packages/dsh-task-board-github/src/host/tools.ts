/**
 * Model-visible tools the GitHub extension contributes to the task board.
 *
 * This file lives with the provider: the board's own agent-tools module never
 * learns GitHub vocabulary. The tools register through the extension
 * capability face, so they follow the same board-enabled x extension-enabled
 * gate as every other provider surface.
 *
 * @module dsh-task-board-github/host/tools
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { addRepository, removeRepository, updateRepository, type RepositoryOptions } from '../core/setup.ts'
import { readTaskGitHubMetadata } from '../core/types.ts'
import type { TaskRecord } from '../core/task-record.ts'
import type { GitHubSyncService } from './service.ts'
import { GitHubSetupError, type GitHubSetup } from './setup.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

function json(value: unknown): Json {
  return value as Json
}

function refused(code: string, message: string): Json {
  return json({ ok: false, code, message })
}

function githubTaskSummary(task: TaskRecord): Record<string, unknown> {
  const gh = readTaskGitHubMetadata(task)
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    archived: task.archivedAt !== undefined,
    github: gh === undefined ? undefined : {
      owner: gh.owner,
      repository: gh.repository,
      issueNumber: gh.issueNumber,
      issueUrl: gh.issueUrl,
      remoteTitle: gh.remoteTitle,
      remoteState: gh.remoteState,
      remoteLabels: gh.remoteLabels,
      lastSyncedAt: gh.lastSyncedAt,
      lastSyncError: gh.lastSyncError,
      deactivated: gh.deactivated,
      pullRequest: gh.pullRequest,
    },
  }
}

/** Every GitHub tool, bound to the running sync service. */
export function buildGitHubTools(service: GitHubSyncService): ToolDefinition[] {
  return [
    buildListTool(service),
    buildGetTool(service),
    buildRefreshTool(service),
    buildCreatePrTool(service),
    buildLinkPrTool(service),
    buildCommentTool(service),
    buildCloseIssueTool(service),
  ]
}

/**
 * The configuration tools: what lets a model set this extension up end to end
 * — credential, repositories and a live connection test — without a user
 * editing a profile patch by hand.
 *
 * They render the same setup surface the settings card and the host routes
 * use, so a model and a person writing the same configuration produce the same
 * stored value. The token is written once and never read back: no tool result
 * and no summary carries its value, only whether one is configured, where it
 * came from and whether it is writable.
 * @param setup - the shared setup surface; absent registers no setup tool.
 * @returns the setup tools, or none.
 */
export function buildSetupTools(setup: GitHubSetup | undefined): ToolDefinition[] {
  if (setup === undefined) return []
  return [buildSetupTool(setup), buildRepositoriesTool(setup)]
}

function buildSetupTool(setup: GitHubSetup): ToolDefinition {
  return defineTool({
    name: 'task_board_github_setup',
    description: 'Configure the task board GitHub Issues integration: read the setup status, store or clear the GitHub token, and run a live connection test against GitHub. The token is stored host-side in the harness credential store and is never returned by any tool. Because a token passed as an argument becomes part of this conversation, prefer asking the user to paste it in the extension settings card when they can reach it.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'set-token', 'clear-token', 'test'], description: 'status reads the current configuration; set-token stores the token; clear-token removes it; test calls GitHub.' },
      token: { type: 'string', description: 'GitHub token to store; required by set-token. It becomes part of this conversation.' },
      owner: { type: 'string', description: 'Repository owner to test only that repository.' },
      repository: { type: 'string', description: 'Repository name to test only that repository.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try {
        switch (args.action) {
          case 'status':
            return json({ ok: true, status: await setup.status() })
          case 'set-token': {
            if (typeof args.token !== 'string' || args.token.trim() === '') {
              return refused('token-required', 'set-token needs the token to store')
            }
            return json({ ok: true, status: await setup.setCredential(args.token) })
          }
          case 'clear-token':
            return json({ ok: true, status: await setup.clearCredential() })
          case 'test': {
            const target = typeof args.owner === 'string' && typeof args.repository === 'string'
              ? { owner: args.owner, repository: args.repository }
              : {}
            return json({ ok: true, report: await setup.test(target) })
          }
          default:
            return refused('unknown-action', 'action must be status, set-token, clear-token or test')
        }
      } catch (error) {
        return refused(error instanceof GitHubSetupError ? error.code : 'setup-failed', describeSetupError(error))
      }
    },
  })
}

function buildRepositoriesTool(setup: GitHubSetup): ToolDefinition {
  return defineTool({
    name: 'task_board_github_repositories',
    description: 'Read and edit the repositories the GitHub Issues integration synchronizes with the task board. An issue is included when it carries the inclusion label or is assigned to the configured assignee. A repository is written to the plugin configuration as soon as the call returns, so no restart is needed.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'remove', 'update'], description: 'list reads the configured repositories; add, remove and update rewrite the list.' },
      repository: { type: 'string', description: 'Repository to act on: owner/repo, a GitHub URL, or an SSH remote. Required by add, remove and update.' },
      inclusionLabel: { type: 'string', description: 'Issue label that opts an issue into the board (default dsh).' },
      assignee: { type: 'string', description: 'Login whose assigned issues are included too; use @me for the account the host is authenticated as, or an empty string to turn the channel off. Trivial filters such as "assigned to me" belong here.' },
      includeUnassigned: { type: 'boolean', description: 'Whether issues assigned to nobody are included too; set it on repositories whose issues are never assigned. It never pulls in issues assigned to other people.' },
      baseBranch: { type: 'string', description: 'Base branch pull requests target (default main).' },
      prCreationEnabled: { type: 'boolean', description: 'Whether the extension may open pull requests for completed cards.' },
      pollingIntervalMs: { type: 'number', description: 'Background polling interval in milliseconds (default 300000; 0 disables polling).' },
      analysisModel: { type: 'string', description: 'Qualified provider/model the AI issue analysis uses for this repository\'s cards; an empty string falls back to the card\'s pinned model, then the host default.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const current = setup.listRepositories()
      if (args.action === 'list') return json({ ok: true, repositories: current })
      const input = typeof args.repository === 'string' ? args.repository : ''
      const options: RepositoryOptions = {}
      if (typeof args.inclusionLabel === 'string' && args.inclusionLabel.trim() !== '') options.inclusionLabel = args.inclusionLabel.trim()
      // An explicit empty string is meaningful here: it turns the assignee
      // channel off without dropping the repository.
      if (typeof args.assignee === 'string') options.assignee = args.assignee.trim()
      if (typeof args.includeUnassigned === 'boolean') options.includeUnassigned = args.includeUnassigned
      if (typeof args.baseBranch === 'string' && args.baseBranch.trim() !== '') options.baseBranch = args.baseBranch.trim()
      if (typeof args.prCreationEnabled === 'boolean') options.prCreationEnabled = args.prCreationEnabled
      if (typeof args.pollingIntervalMs === 'number' && Number.isFinite(args.pollingIntervalMs) && args.pollingIntervalMs >= 0) {
        options.pollingIntervalMs = Math.floor(args.pollingIntervalMs)
      }
      if (typeof args.analysisModel === 'string') options.analysisModel = args.analysisModel.trim()
      // The same pure edits the settings card runs, so a model and a person
      // adding "deepseek-ai/dsh" produce one stored value.
      const edit = args.action === 'add'
        ? addRepository(current, input, options)
        : args.action === 'remove'
          ? removeRepository(current, input)
          : args.action === 'update'
            ? updateRepository(current, input, options)
            : undefined
      if (edit === undefined) return refused('unknown-action', 'action must be list, add, remove or update')
      if (!edit.ok) return refused(edit.code, edit.message)
      try {
        const repositories = await setup.writeRepositories(edit.repositories)
        return json({ ok: true, repositories })
      } catch (error) {
        return refused(error instanceof GitHubSetupError ? error.code : 'write-failed', describeSetupError(error))
      }
    },
  })
}

/** Phrase one setup failure for a model reading a tool result. */
function describeSetupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


function buildListTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_list',
    description: 'List task board cards associated with GitHub issues, with their remote issue state, remote labels, and pull request metadata.',
    parameters: {
      owner: { type: 'string', description: 'Filter by repository owner.' },
      repository: { type: 'string', description: 'Filter by repository name.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by remote issue state (open, closed, or all; default: all).' },
      hasPr: { type: 'boolean', description: 'Filter by whether a pull request is linked.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const filtered = service.listTasks({
        ...(typeof args.owner === 'string' ? { owner: args.owner } : {}),
        ...(typeof args.repository === 'string' ? { repository: args.repository } : {}),
        ...(args.state === 'open' || args.state === 'closed' || args.state === 'all' ? { state: args.state } : {}),
        ...(typeof args.hasPr === 'boolean' ? { hasPr: args.hasPr } : {}),
      })
      return json({ tasks: filtered.map(task => githubTaskSummary(task)) })
    },
    // Pure projection of the in-memory index: safe to overlap with sibling calls.
    isConcurrencySafe: () => true,
  })
}

function buildGetTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_get',
    description: 'Get full GitHub integration details for a task board card, including remote issue title, body, labels, pull request details, and synchronization state.',
    parameters: {
      taskId: { type: 'string', description: 'Task ID on the board.' },
      owner: { type: 'string', description: 'Repository owner (used with repository and issueNumber).' },
      repository: { type: 'string', description: 'Repository name (used with owner and issueNumber).' },
      issueNumber: { type: 'number', description: 'GitHub issue number.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      let task: TaskRecord | undefined
      if (typeof args.taskId === 'string' && args.taskId.trim() !== '') {
        task = service.host.tasks.get(args.taskId.trim())
      } else if (
        typeof args.owner === 'string'
        && typeof args.repository === 'string'
        && typeof args.issueNumber === 'number'
      ) {
        const o = args.owner.toLowerCase()
        const r = args.repository.toLowerCase()
        task = service.host.tasks.list().find(candidate => {
          const gh = readTaskGitHubMetadata(candidate)
          return gh !== undefined
            && gh.owner.toLowerCase() === o
            && gh.repository.toLowerCase() === r
            && gh.issueNumber === args.issueNumber
        })
      }
      const metadata = readTaskGitHubMetadata(task)
      if (task === undefined || metadata === undefined) {
        return refused('not-found', 'task with GitHub integration not found')
      }
      return json({
        ok: true,
        task: {
          taskId: task.id,
          title: task.title,
          description: task.description,
          prompt: task.prompt,
          status: task.status,
          archived: task.archivedAt !== undefined,
          github: metadata,
        },
      })
    },
    // Reads the in-memory index and fixture metadata only.
    isConcurrencySafe: () => true,
  })
}

function buildRefreshTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_refresh',
    description: 'Trigger synchronization between GitHub issues/pull requests and the task board for a task, a repository, or all configured repositories.',
    parameters: {
      taskId: { type: 'string', description: 'Specific task ID to refresh.' },
      owner: { type: 'string', description: 'Repository owner to refresh.' },
      repository: { type: 'string', description: 'Repository name to refresh.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      if (service.repositories.length === 0) {
        return refused('not-configured', 'GitHub integration is not configured')
      }
      try {
        if (typeof args.taskId === 'string' && args.taskId.trim() !== '') {
          const result = await service.syncTask(args.taskId.trim())
          if (!result.ok) return refused('sync-failed', result.error ?? 'sync failed')
          const updated = service.host.tasks.get(args.taskId.trim())
          return json({ ok: true, synced: 1, task: updated ? githubTaskSummary(updated) : undefined })
        } else if (typeof args.owner === 'string' && typeof args.repository === 'string') {
          const result = await service.syncRepository(args.owner.trim(), args.repository.trim())
          return json({ ok: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined })
        } else {
          const result = await service.syncAll()
          return json({ ok: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined })
        }
      } catch (error) {
        return refused('sync-error', error instanceof Error ? error.message : String(error))
      }
    },
  })
}

function buildCreatePrTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_create_pr',
    description: 'Create a GitHub Pull Request for a task board card linked to a GitHub issue. Verifies that the head branch exists on remote, creates the PR, records PR metadata, and adds the PR phase label to the issue. Does not run shell commands.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task ID linked to a GitHub issue.' },
      headBranch: { type: 'string', required: true, description: 'Remote head branch containing the changes (must already exist on remote).' },
      baseBranch: { type: 'string', description: 'Target base branch (default: repository default, e.g. main).' },
      title: { type: 'string', description: 'PR title (default: task title).' },
      body: { type: 'string', description: 'PR body text (default includes "Fixes #<issue>" and task description).' },
      draft: { type: 'boolean', description: 'Whether to create the PR as draft.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const task = service.host.tasks.get(args.taskId)
      if (readTaskGitHubMetadata(task) === undefined) {
        return refused('not-github-task', 'task is not linked to a GitHub issue')
      }
      try {
        const pr = await service.createPullRequest(args.taskId, {
          headBranch: args.headBranch,
          ...(args.baseBranch === undefined ? {} : { baseBranch: args.baseBranch }),
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.draft === undefined ? {} : { draft: args.draft }),
        })
        return json({ ok: true, pullRequest: pr })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('does not exist on remote')) {
          return refused('branch-not-found', message)
        }
        return refused('create-pr-failed', message)
      }
    },
  })
}


function buildCommentTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_comment',
    description: 'Post one comment on the GitHub issue behind a task board card. Use it to report what was done, link the pull request, or state why the task was closed without a fix. The body is Markdown and must stay under the length limit. Does not run shell commands.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task ID linked to a GitHub issue.' },
      body: { type: 'string', required: true, description: 'Markdown comment body to post. Must be non-empty and under the length limit; a transcript belongs in the card, not in a comment.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try {
        const comment = await service.postComment(args.taskId, args.body)
        return json({ ok: true, comment })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return refused(message.includes('not linked') ? 'not-github-task' : 'comment-failed', message)
      }
    },
  })
}

function buildCloseIssueTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_close_issue',
    description: 'Close the GitHub issue behind a task board card, once the work has actually landed. Refused unless the card has a linked pull request that is MERGED: a passing local run is not a reviewed change. Does not run shell commands.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task ID linked to a GitHub issue.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try {
        const closed = await service.closeIssue(args.taskId)
        return json({ ok: true, ...closed })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes('not linked')
          ? 'not-github-task'
          : message.includes('not merged')
            ? 'pr-not-merged'
            : message.includes('no linked pull request')
              ? 'no-linked-pr'
              : 'close-issue-failed'
        return refused(code, message)
      }
    },
  })
}

function buildLinkPrTool(service: GitHubSyncService): ToolDefinition {
  return defineTool({
    name: 'task_board_github_link_pr',
    description: 'Link an existing GitHub Pull Request to a task board card linked to a GitHub issue, updating PR metadata and managed phase labels.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task ID linked to a GitHub issue.' },
      pullRequestNumber: { type: 'number', required: true, description: 'Pull request number on GitHub.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      const task = service.host.tasks.get(args.taskId)
      if (readTaskGitHubMetadata(task) === undefined) {
        return refused('not-github-task', 'task is not linked to a GitHub issue')
      }
      try {
        const pr = await service.linkPullRequest(args.taskId, args.pullRequestNumber)
        return json({ ok: true, pullRequest: pr })
      } catch (error) {
        return refused('link-pr-failed', error instanceof Error ? error.message : String(error))
      }
    },
  })
}
