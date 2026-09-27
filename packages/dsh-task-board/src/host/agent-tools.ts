/**
 * Agent tools for the task board: the DSH-native counterpart of the board UI.
 *
 * Every tool drives the same Host ledger the browser drives, so a task created
 * in the GUI is immediately operable from any session and vice versa. Domain
 * refusals come back as ok:false values the model can react to; the Host
 * ledger stays the only authority, so every gate the UI honors still holds
 * here (fail-closed pins, the permission confirmation gate, the subtask depth
 * limit, the running-task locks).
 *
 * Deliberately absent: confirm-permission. That gate exists so a HUMAN lifts an
 * above-default permission binding; a tool that could stamp it would make the
 * gate decorative. An agent that hits it must ask the user to confirm in the
 * board UI.
 *
 * @module dsh-task-board/host/agent-tools
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DEFAULT_SESSION_PERMISSION, requiresPermissionConfirmation } from '../core/handover.ts'
import { DEFAULT_SUBTASK_DEPTH, directSubtasks, taskDepth } from '../core/subtask.ts'
import {
  TASK_PERMISSIONS,
  type ExecutionRecord,
  type NewTaskInput,
  type ScheduleRule,
  type TaskPermission,
  type TaskRecord,
  type TaskTag,
} from '../core/tasks.ts'
import type { TaskUpdatePatch } from '../core/use-cases/task-update.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from '../protocol.ts'

/**
 * The narrow Host face the tools need. TaskBoardHostService satisfies it
 * structurally, so tests and a future host can drive the same surface.
 */
export interface TaskBoardToolHost {
  /** Current board snapshot (tasks + scheduler + power + deployment constants). */
  snapshot(): TaskBoardSnapshot
  /** Submit one confirmed Host action; returns the resulting snapshot. */
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot
}

/** Registered tool names, in registration order. */
export const TASK_BOARD_TOOL_NAMES = [
  'task_board_list',
  'task_board_get',
  'task_board_create',
  'task_board_update',
  'task_board_set_parent',
  'task_board_run',
  'task_board_manage',
  'task_board_schedule',
] as const

/** Unconstrained JSON value the tools return (their output schema is the JSON node). */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Model-facing JSON rendering shared by every tool. */
function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

/** Mark an already JSON-safe projection as the tool's canonical value. */
function json(value: unknown): Json {
  return value as Json
}

/** A domain refusal the model is expected to read and act on. */
function refused(code: string, message: string): Json {
  return json({ ok: false, code, message })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * The calling session id, for the execution audit trail (the same stamp the
 * browser asserts). Absent when a call has no agent behind it.
 */
export function callingSessionId(exec: { agent?: unknown }): string | undefined {
  const agent = exec.agent as { session?: { id?: unknown; header?: { id?: unknown } } } | undefined
  const id = agent?.session?.id ?? agent?.session?.header?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

function scheduleView(schedule: ScheduleRule): Record<string, unknown> {
  return {
    enabled: schedule.enabled,
    cron: schedule.cron,
    ...(schedule.nextRunAt === undefined ? {} : { nextRunAt: schedule.nextRunAt }),
    ...(schedule.lastTriggeredAt === undefined ? {} : { lastTriggeredAt: schedule.lastTriggeredAt }),
  }
}

function tagView(tag: TaskTag): Record<string, unknown> {
  return { name: tag.name, ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }) }
}

function executionView(execution: ExecutionRecord): Record<string, unknown> {
  return {
    id: execution.id,
    ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
    startedAt: execution.startedAt,
    ...(execution.endedAt === undefined ? {} : { endedAt: execution.endedAt }),
    ...(execution.result === undefined ? {} : { result: execution.result }),
    ...(execution.error === undefined ? {} : { error: execution.error }),
    // The session that asked for the run (audit only; client-asserted by the
    // browser, the calling session here).
    ...(execution.initiatedBy === undefined ? {} : { initiatedBy: execution.initiatedBy }),
    ...(execution.runGroupId === undefined ? {} : { cascade: true }),
    // A deferred cascade parent has settled its own turn but still waits for
    // its subtasks; that is not a stuck card and the model must not retry it.
    ...(execution.ownResult === undefined
      ? {}
      : { ownResult: execution.ownResult, awaitingSubtasks: execution.endedAt === undefined }),
  }
}

/**
 * One compact task row for the model: identity, column, lineage, execution
 * targets, schedule, and the latest run. The prompt body rides only
 * task_board_get, so a fifty-task list stays readable.
 */
function taskSummary(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  sessionDefault: TaskPermission | undefined,
): Record<string, unknown> {
  const latest = task.executions.at(-1)
  const subtaskCount = directSubtasks(tasks, task.id).length
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    description: task.description,
    ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    ...(subtaskCount === 0 ? {} : { subtaskCount }),
    ...(task.archivedAt === undefined ? {} : { archivedAt: task.archivedAt }),
    ...(task.tags === undefined ? {} : { tags: task.tags.map(tagView) }),
    ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
    ...(task.mode === undefined ? {} : { mode: task.mode }),
    ...(task.permission === undefined ? {} : { permission: task.permission }),
    ...(task.model === undefined ? {} : { model: task.model }),
    ...(task.reuseSession === true ? { reuseSession: true } : {}),
    ...(task.teamRun === true ? { teamRun: true } : {}),
    ...(task.schedule === undefined ? {} : { schedule: scheduleView(task.schedule) }),
    ...(task.freeze === undefined ? {} : { continuationCard: true }),
    ...(task.permissionConfirmedAt === undefined ? {} : { permissionConfirmedAt: task.permissionConfirmedAt }),
    // Whether this card may run at all: an elevated binding still needs a
    // human confirmation, and only a human can give it.
    ...(requiresPermissionConfirmation(task, sessionDefault ?? DEFAULT_SESSION_PERMISSION)
      ? { permissionPending: true }
      : {}),
    executionCount: task.executions.length,
    ...(latest === undefined ? {} : { latestExecution: executionView(latest) }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/** One task's full detail: content, lineage, schedule, and recent runs. */
function taskDetail(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  sessionDefault: TaskPermission | undefined,
): Record<string, unknown> {
  const parent = task.parentId === undefined ? undefined : tasks.find(item => item.id === task.parentId)
  return {
    ...taskSummary(task, tasks, sessionDefault),
    prompt: task.prompt,
    depth: taskDepth(tasks, task.id),
    ...(parent === undefined ? {} : { parent: { id: parent.id, title: parent.title, status: parent.status } }),
    ...(task.freeze === undefined
      ? {}
      : {
        freeze: {
          goal: task.freeze.goal,
          progress: task.freeze.progress,
          next: task.freeze.next,
          frozenAt: task.freeze.frozenAt,
          ...(task.freeze.frozenBy === undefined ? {} : { frozenBy: task.freeze.frozenBy }),
          ...(task.freeze.redacted === true ? { redacted: true } : {}),
        },
      }),
    ...(task.handover === undefined
      ? {}
      : {
        handover: {
          ...(task.handover.workspaceId === undefined ? {} : { workspaceId: task.handover.workspaceId }),
          ...(task.handover.mode === undefined ? {} : { mode: task.handover.mode }),
          ...(task.handover.permission === undefined ? {} : { permission: task.handover.permission }),
          references: task.handover.references,
          bundledAt: task.handover.bundledAt,
        },
      }),
    subtasks: directSubtasks(tasks, task.id).map(child => taskSummary(child, tasks, sessionDefault)),
    executions: task.executions.slice(-10).map(executionView),
  }
}

/** The executions a run opened: everything that was not in the ledger before. */
function openedExecutions(before: readonly ExecutionRecord[], after: readonly ExecutionRecord[]): ExecutionRecord[] {
  const known = new Set(before.map(execution => execution.id))
  return after.filter(execution => !known.has(execution.id))
}

/** Board summary attached to task_board_list. */
function boardView(snapshot: TaskBoardSnapshot, maxSubtaskDepth: number): Record<string, unknown> {
  const counts = { backlog: 0, todo: 0, running: 0, done: 0, failed: 0, archived: 0 }
  for (const task of snapshot.tasks) {
    if (task.archivedAt !== undefined) counts.archived += 1
    else counts[task.status] += 1
  }
  return {
    revision: snapshot.revision,
    timeZone: snapshot.scheduler.timeZone,
    ...(snapshot.scheduler.error === undefined ? {} : { schedulerError: snapshot.scheduler.error }),
    maxSubtaskDepth,
    sessionDefaultPermission: snapshot.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION,
    runningSessions: snapshot.power.runningSessions,
    armedSchedules: snapshot.power.armedSchedules,
    counts,
  }
}

/**
 * Build every task-board tool bound to one Host service.
 * @param host - the Host ledger/service face (TaskBoardHostService).
 * @returns the tool definitions, in TASK_BOARD_TOOL_NAMES order.
 */
export function buildTaskBoardTools(host: TaskBoardToolHost): ToolDefinition[] {
  return [
    buildListTool(host),
    buildGetTool(host),
    buildCreateTool(host),
    buildUpdateTool(host),
    buildSetParentTool(host),
    buildRunTool(host),
    buildManageTool(host),
    buildScheduleTool(host),
  ]
}

function buildSetParentTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_set_parent',
    description: [
      'Attach an existing task under a parent (making it a subtask) or detach it back to the root board by setting its parentId.',
      'Pass an empty parentId to detach.',
      'The Host refuses the link when the parent is unknown or archived, when the moved task is one of its own descendants, when the resulting depth exceeds the deployment subtask limit (default one level, maximum three), or while the task has an unsettled execution (its link may still be a running cascade parent pointer).',
      'Running a task runs its whole subtree concurrently; a parent card settles only after its own turn and every direct subtask settle.',
      'Triggers: 任务看板, task board, 看板, 子任务, subtask, 关联任务, link task, 解除关联, detach.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task whose parent link changes.' },
      parentId: { type: 'string', required: true, description: 'Parent task id, or an empty string to detach the task back to the root board.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      try {
        const snapshot = host.apply(
          crypto.randomUUID(),
          { kind: 'set-parent', taskId: args.taskId, parentId: args.parentId === '' ? null : args.parentId },
          callingSessionId(exec),
        )
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildRunTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_run',
    description: [
      'Run a task on the board now, or re-run a settled one.',
      'Running a task also runs its whole subtask tree CONCURRENTLY: the Host opens one real DSH session per member under one run group, each replaying its card pinned workspace, agent preset, permission and model; a subtask that does not pin them inherits its nearest ancestor.',
      'The parent card stays in the running column until its own turn and every direct subtask have settled, and it fails when any member failed; one failing subtask never stops the others.',
      'A card whose effective permission is above the deployment session default is refused with confirmation-required until a HUMAN confirms the binding in the board UI; this tool cannot confirm it.',
      'A card whose task carries teamRun instead starts ONE Team Lead session and the Host spawns a teammate per subtask inside it, so those cards run as an Agent Team rather than as independent sessions; that mode needs the deployment Agent Teams service and is refused when it is missing.',
      'Executions consume real API quota. Sessions are created asynchronously, so read their ids and outcomes back with task_board_get.',
      'Triggers: 任务看板, task board, 看板, 执行任务, run task, 重新执行, rerun, 子任务, subtask.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task to run; running a root task runs its whole subtree.' },
      rerun: { type: 'boolean', description: 'Re-run a settled task: reset its column to todo before starting (default false).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const before = host.snapshot()
      try {
        const snapshot = host.apply(
          crypto.randomUUID(),
          { kind: args.rerun === true ? 'rerun' : 'run', taskId: args.taskId },
          callingSessionId(exec),
        )
        const beforeById = new Map(before.tasks.map(task => [task.id, task]))
        const started = snapshot.tasks.flatMap(task => {
          const previous = beforeById.get(task.id)?.executions ?? []
          return openedExecutions(previous, task.executions).map(execution => ({
            taskId: task.id,
            title: task.title,
            executionId: execution.id,
            ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
          }))
        })
        const root = snapshot.tasks.find(task => task.id === args.taskId)
        return json({
          ok: true,
          started,
          ...(root === undefined ? {} : { task: taskSummary(root, snapshot.tasks, snapshot.sessionDefaultPermission) }),
          note: 'Executions run asynchronously; call task_board_get to read session ids and the settled outcome. The parent settles only after its own turn and every direct subtask settle.',
        })
      } catch (error) {
        const message = messageOf(error)
        return refused(message.startsWith('confirmation-required') ? 'confirmation-required' : 'refused', message)
      }
    },
  })
}

function buildManageTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_manage',
    description: [
      'Move, archive, restore, or delete one task board card.',
      'move-todo and move-backlog are the manual column moves; a running card cannot be moved.',
      'archive takes the whole subtask tree off the board and is refused while any member has an unsettled execution; restore brings the task, its ancestors and its subtree back; delete removes one card and is refused while it still has subtasks (detach or delete them first) or while it runs.',
      'It cannot confirm a permission binding: the confirmation gate is a human act performed in the board UI.',
      'Triggers: 任务看板, task board, 看板, 归档, archive, 删除任务, delete task, 移动任务, move task.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task to act on.' },
      action: {
        type: 'string',
        required: true,
        enum: ['move-todo', 'move-backlog', 'archive', 'restore', 'delete'],
        description: 'The lifecycle operation to perform.',
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const initiator = callingSessionId(exec)
      const actions: Record<string, TaskBoardAction> = {
        'move-todo': { kind: 'move', taskId: args.taskId, status: 'todo' },
        'move-backlog': { kind: 'move', taskId: args.taskId, status: 'backlog' },
        archive: { kind: 'archive', taskId: args.taskId },
        restore: { kind: 'restore', taskId: args.taskId },
        delete: { kind: 'delete', taskId: args.taskId },
      }
      const action = actions[args.action]
      if (action === undefined) return refused('unknown-action', 'unsupported action ' + args.action)
      if (!host.snapshot().tasks.some(task => task.id === args.taskId)) {
        return refused('task-not-found', 'no task with id ' + args.taskId)
      }
      try {
        const snapshot = host.apply(crypto.randomUUID(), action, initiator)
        if (args.action === 'delete') return json({ ok: true, action: args.action, taskId: args.taskId })
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, action: args.action, task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildScheduleTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_schedule',
    description: [
      'Arm, change, or disarm a task scheduled runs (5-field cron in the Host local time zone; day-of-month and day-of-week use OR semantics).',
      'A due scheduled task runs the same cascade a manual run does, so a root task runs its whole subtask tree.',
      'A schedule whose tree contains an unconfirmed above-default permission is refused and rolls to its next occurrence; the reason is reported in the list board summary as schedulerError.',
      'Missed occurrences during Host downtime are skipped, never queued; a task that is already running skips its occurrence.',
      'Triggers: 任务看板, task board, 看板, 定时任务, schedule, cron, 每天执行.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task whose schedule changes.' },
      enabled: { type: 'boolean', description: 'Arm (true) or disarm (false) the schedule.' },
      cron: { type: 'string', description: '5-field cron expression: minute hour day-of-month month day-of-week.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      if (args.enabled === undefined && args.cron === undefined) {
        return refused('nothing-to-change', 'pass enabled and/or cron')
      }
      // A missing card must read as a missing card: the ledger reports an
      // unknown id through the same refusal as a malformed cron.
      if (!host.snapshot().tasks.some(task => task.id === args.taskId)) {
        return refused('task-not-found', 'no task with id ' + args.taskId)
      }
      const patch: { enabled?: boolean; cron?: string } = {
        ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
        ...(args.cron === undefined ? {} : { cron: args.cron }),
      }
      try {
        const snapshot = host.apply(crypto.randomUUID(), { kind: 'set-schedule', taskId: args.taskId, patch }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({
          ok: true,
          schedule: task.schedule === undefined ? null : scheduleView(task.schedule),
          task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission),
        })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}


function buildListTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_list',
    description: [
      'List tasks on the DSH task board (the Host-authoritative ledger behind the Web GUI task board).',
      'Filters: status column, parentId (direct subtasks), rootsOnly, tag, free-text query, and archived inclusion.',
      'Returns each task id, title, column, parent/subtask link, execution targets, schedule and latest run outcome, plus the board summary (revision, time zone, subtask depth limit, session-default permission).',
      'Use task_board_get for one task in full, task_board_create to add work, and task_board_run to execute it.',
      'Triggers: 任务看板, task board, 看板, 子任务, subtask, task list, 定时任务, scheduled task.',
    ].join(' '),
    parameters: {
      status: { type: 'string', enum: ['backlog', 'todo', 'running', 'done', 'failed'], description: 'Only cards in this column.' },
      parentId: { type: 'string', description: 'Only the direct subtasks of this task id.' },
      rootsOnly: { type: 'boolean', description: 'Only tasks that have no parent (default false).' },
      includeArchived: { type: 'boolean', description: 'Include archived tasks (default false).' },
      tag: { type: 'string', description: 'Only tasks carrying this label name.' },
      query: { type: 'string', description: 'Case-insensitive match against title, description, prompt, and label names.' },
      limit: { type: 'integer', description: 'Maximum rows to return (default 50, maximum 200).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      const snapshot = host.snapshot()
      const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const limit = Math.min(Math.max(typeof args.limit === 'number' ? Math.trunc(args.limit) : 50, 1), 200)
      const matched = snapshot.tasks.filter(task => {
        if (args.includeArchived !== true && task.archivedAt !== undefined) return false
        if (args.status !== undefined && task.status !== args.status) return false
        if (args.parentId !== undefined && task.parentId !== args.parentId) return false
        if (args.rootsOnly === true && task.parentId !== undefined) return false
        if (args.tag !== undefined && !(task.tags ?? []).some(tag => tag.name === args.tag)) return false
        if (needle !== '') {
          const haystack = [task.title, task.description, task.prompt, ...(task.tags ?? []).map(tag => tag.name)].join('\n').toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        return true
      })
      return json({
        ok: true,
        board: boardView(snapshot, snapshot.maxSubtaskDepth ?? DEFAULT_SUBTASK_DEPTH),
        total: matched.length,
        count: Math.min(matched.length, limit),
        tasks: matched.slice(0, limit).map(task => taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission)),
      })
    },
  })
}

function buildGetTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_get',
    description: [
      'Read one task board card in full: prompt, description, labels, column, parent link, direct subtasks, execution targets, schedule, permission gate state, and the last ten execution attempts with their session ids and outcomes.',
      'Use it before running or editing a card, and after a run to read the settled outcome.',
      'Triggers: 任务看板, task board, 看板, 子任务, subtask, task detail.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task id, as reported by task_board_list or task_board_create.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      const snapshot = host.snapshot()
      const task = snapshot.tasks.find(item => item.id === args.taskId)
      if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
      return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
    },
  })
}

function buildCreateTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_create',
    description: [
      'Create a task on the DSH task board, or a subtask by passing parentId.',
      'A subtask inherits every execution target it does not override (workspace, agent preset, permission, model) from its parent, and inherits the parent human permission confirmation together with an inherited binding.',
      'The deployment caps subtask depth (default one level, maximum three): a subtask of a subtask is refused unless the board is configured deeper.',
      'The task lands in the todo column and does NOT run; call task_board_run to execute it.',
      'Triggers: 任务看板, task board, 看板, 新建任务, create task, 子任务, subtask, 定时任务.',
    ].join(' '),
    parameters: {
      title: { type: 'string', required: true, description: 'Short display title (one line).' },
      description: { type: 'string', description: 'Longer human description shown in the detail view.' },
      prompt: { type: 'string', description: 'The instruction sent to the execution agent; the title is used when blank.' },
      parentId: { type: 'string', description: 'Parent task id, making this a subtask. Omit for a root task.' },
      workspaceId: { type: 'string', description: 'Workspace id the execution must run in; omit to inherit the parent value or use the most recent workspace.' },
      mode: { type: 'string', description: 'Agent preset id the execution session is composed from; omit for the deployment default or the parent value.' },
      permission: { type: 'string', enum: [...TASK_PERMISSIONS], description: 'Permission preset for the execution session. Omit to inherit the parent binding; a value above the session default needs a human confirmation in the board UI before the card can run.' },
      model: { type: 'string', description: 'Pinned model as provider/model (or a model id); omit for the host default or the parent value.' },
      reuseSession: { type: 'boolean', description: 'Continue later runs in the previous execution session instead of a fresh conversation.' },
      teamRun: { type: 'boolean', description: 'Run this task as an Agent Team: running it starts one Team Lead session and the Host spawns a teammate per subtask inside it. Omit or false for one independent session per member. Refused when the deployment serves no Agent Teams service.' },
      tags: {
        type: 'array',
        description: 'Labels: the name renders as a badge and drives the board filter; promptPrefix is injected ahead of the execution prompt on every run.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Label name (unique within the task, at most 32 characters).' },
            promptPrefix: { type: 'string', description: 'Optional prompt line injected before the task prompt (at most 200 characters).' },
          },
        },
      },
      schedule: {
        type: 'object',
        additionalProperties: false,
        description: 'Arm a 5-field cron schedule at creation time (Host local time zone).',
        properties: {
          enabled: { type: 'boolean', required: true, description: 'Whether the schedule is armed.' },
          cron: { type: 'string', required: true, description: '5-field cron: minute hour day-of-month month day-of-week.' },
        },
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      if (args.title.trim() === '') return refused('title-required', 'title must not be blank')
      const id = crypto.randomUUID()
      const tags = (args.tags ?? []).map(tag => ({
        name: tag.name,
        ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }),
      }))
      const input: NewTaskInput = {
        title: args.title,
        description: args.description ?? '',
        prompt: args.prompt ?? '',
        ...(args.parentId === undefined || args.parentId === '' ? {} : { parentId: args.parentId }),
        ...(args.workspaceId === undefined || args.workspaceId === '' ? {} : { workspaceId: args.workspaceId }),
        ...(args.mode === undefined || args.mode === '' ? {} : { mode: args.mode }),
        ...(args.permission === undefined ? {} : { permission: args.permission }),
        ...(args.model === undefined || args.model === '' ? {} : { model: args.model }),
        ...(args.reuseSession === true ? { reuseSession: true } : {}),
        ...(args.teamRun === true ? { teamRun: true } : {}),
        ...(tags.length === 0 ? {} : { tags }),
        ...(args.schedule === undefined ? {} : { schedule: { enabled: args.schedule.enabled, cron: args.schedule.cron } }),
      }
      try {
        const snapshot = host.apply(crypto.randomUUID(), { kind: 'create', id, input }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === id)
        if (task === undefined) return refused('create-failed', 'the Host did not confirm the new task')
        return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildUpdateTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_update',
    description: [
      'Edit a task board card: title, description, prompt, labels, and the execution targets (workspace, agent preset, permission, model, session reuse).',
      'Only the fields you pass change; pass an empty string to clear a target, or an empty labels array to clear the labels.',
      'Title, description and prompt freeze once the task has started executing; the execution targets stay editable because they only affect future runs.',
      'Changing the pinned permission re-arms the permission confirmation gate.',
      'Triggers: 任务看板, task board, 看板, 修改任务, edit task, 子任务, 标签, tags.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task id to edit.' },
      title: { type: 'string', description: 'New title (a blank title is refused by the Host).' },
      description: { type: 'string', description: 'New description.' },
      prompt: { type: 'string', description: 'New execution prompt.' },
      workspaceId: { type: 'string', description: 'New workspace id; an empty string clears it.' },
      mode: { type: 'string', description: 'New agent preset id; an empty string clears it.' },
      permission: { type: 'string', enum: [...TASK_PERMISSIONS, ''], description: 'New permission preset; an empty string clears it back to the session default.' },
      model: { type: 'string', description: 'New pinned model; an empty string clears it.' },
      reuseSession: { type: 'boolean', description: 'Continue later runs in the previous execution session.' },
      teamRun: { type: 'boolean', description: 'Switches this task between a plain cascade (one session per member) and an Agent Team run (Lead session plus a teammate per subtask).' },
      tags: {
        type: 'array',
        description: 'Replacement label set; an empty array clears all labels.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Label name.' },
            promptPrefix: { type: 'string', description: 'Optional prompt line injected before the task prompt.' },
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const patch: TaskUpdatePatch = {}
      if (has(args, 'title') && typeof args.title === 'string') patch.title = args.title
      if (has(args, 'description') && typeof args.description === 'string') patch.description = args.description
      if (has(args, 'prompt') && typeof args.prompt === 'string') patch.prompt = args.prompt
      if (has(args, 'workspaceId') && typeof args.workspaceId === 'string') patch.workspaceId = args.workspaceId
      if (has(args, 'mode') && typeof args.mode === 'string') patch.mode = args.mode
      if (has(args, 'model') && typeof args.model === 'string') patch.model = args.model
      // An empty permission is the wire's clearing value (back to the session default).
      if (has(args, 'permission') && typeof args.permission === 'string') {
        patch.permission = args.permission === '' ? undefined : args.permission
      }
      if (has(args, 'reuseSession')) patch.reuseSession = args.reuseSession === true
      if (has(args, 'teamRun')) patch.teamRun = args.teamRun === true
      if (has(args, 'tags')) {
        const tags = args.tags ?? []
        patch.tags = tags.length === 0
          ? null
          : tags.map(tag => ({
            name: tag.name,
            ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }),
          }))
      }
      if (Object.keys(patch).length === 0) return refused('nothing-to-change', 'pass at least one field to update')
      try {
        const snapshot = host.apply(crypto.randomUUID(), { kind: 'update', taskId: args.taskId, patch }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

