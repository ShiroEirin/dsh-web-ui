/**
 * Agent tool surface: every task_board_* tool drives the real Host ledger, so
 * these tests run the real service (temporary ledger directory, a gateway
 * double for session creation) and assert the same gates the board UI honors.
 *
 * The tool set is deliberately unable to lift the permission confirmation gate;
 * that absence is pinned here as behaviour, not as a naming convention.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTaskBoardTools, TASK_BOARD_TOOL_NAMES } from '../src/host/agent-tools.ts'
import { Config, apply, resolveToolRegistry } from '../src/index.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import type { TaskPermission } from '../src/core/tasks.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

/**
 * The activation tests mount the real Host service, which resolves its ledger
 * from DSH_HOME. That must never be the developer's live home: point it at a
 * scratch directory for the whole file and restore the ambient value after.
 */
let previousHome: string | undefined
let scratchHome: string | undefined

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  scratchHome = mkdtempSync(join(tmpdir(), 'dsh-task-board-tools-home-'))
  process.env.DSH_HOME = scratchHome
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (scratchHome !== undefined) rmSync(scratchHome, { recursive: true, force: true })
  scratchHome = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/** A gateway double answering the session calls one execution launch makes. */
function gateway(): TypertGateway {
  let created = 0
  return {
    invoke: async (request: { namespace: string; method: string }) => {
      if (request.namespace === 'agentPresets') return { presets: [] }
      // The activation tests start the real service, which polls the roster.
      if (request.method === 'list') return { items: [] }
      if (request.method === 'create') {
        created += 1
        return { sessionId: 'session-' + String(created) }
      }
      if (request.method === 'rename') return { title: 'renamed', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      throw new Error('unexpected gateway call: ' + request.method)
    },
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
  } as unknown as TypertGateway
}

interface Harness {
  host: TaskBoardHostService
  tools: ToolDefinition[]
}

/** A live board service with every tool bound to it. */
function harness(options: { sessionDefaultPermission?: TaskPermission; maxSubtaskDepth?: number } = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-tools-'))
  roots.push(root)
  // The ledger owns the session default once it is injected: TaskBoardHostService
  // only forwards that option into a ledger it constructs itself.
  const ledger = new HostTaskLedger(root, () => NOW, {
    ...(options.maxSubtaskDepth === undefined ? {} : { maxSubtaskDepth: options.maxSubtaskDepth }),
    ...(options.sessionDefaultPermission === undefined ? {} : { sessionDefaultPermission: options.sessionDefaultPermission }),
  })
  const host = new TaskBoardHostService(gateway(), {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
  })
  harnesses.push(host)
  return { host, tools: buildTaskBoardTools(host) }
}

const harnesses: TaskBoardHostService[] = []
const activations: Array<{ dispose: () => void }> = []

afterEach(() => {
  for (const host of harnesses.splice(0)) host.dispose()
  for (const activation of activations.splice(0)) activation.dispose()
})

/** Run one tool by name (defineTool validates the arguments first). */
async function call(
  live: Harness,
  name: string,
  args: Record<string, unknown> = {},
  exec: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const tool = live.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error('unknown tool ' + name)
  return await tool.execute(args, exec as never) as Record<string, unknown>
}

/** The single task id a fresh board holds. */
async function onlyTaskId(live: Harness): Promise<string> {
  const list = await call(live, 'task_board_list')
  const tasks = list.tasks as Array<{ id: string }>
  const id = tasks[0]?.id
  if (id === undefined) throw new Error('board holds no task')
  return id
}

describe('agent tool definitions', () => {
  it('operator builds every declared tool with a unique name', () => {
    // Given a live board service
    const live = harness()

    // When the tool surface is built
    const names = live.tools.map(tool => tool.name)

    // Then every declared name exists exactly once, with a description and a renderer
    expect(names).toEqual([...TASK_BOARD_TOOL_NAMES])
    expect(new Set(names).size).toBe(names.length)
    expect(live.tools.every(tool => tool.description.length > 0)).toBe(true)
    expect(live.tools.every(tool => typeof tool.output.render === 'function')).toBe(true)
  })

  it('operator finds no tool that could lift the permission confirmation gate', () => {
    // Given the declared tool names and the manage tool's action choices
    const live = harness()
    const manage = live.tools.find(tool => tool.name === 'task_board_manage')

    // When the surface is inspected for a confirmation capability
    const names = TASK_BOARD_TOOL_NAMES.join(',')
    const actions = JSON.stringify(manage?.parameters ?? {})

    // Then neither the surface nor the lifecycle action enum carries one
    expect(names).not.toContain('confirm')
    expect(actions).not.toContain('confirm')
  })
})

describe('tool argument validation', () => {
  it('operator sending a call without its required id is rejected before the ledger runs', async () => {
    // Given an empty board and the get tool
    const live = harness()

    // When the model calls it without the required taskId
    // Then the typed schema rejects the call
    await expect(call(live, 'task_board_get', {})).rejects.toThrow()
    expect((await call(live, 'task_board_list')).total).toBe(0)
  })

  it('operator asking manage for a confirmation action is rejected by the schema', async () => {
    // Given a card and the lifecycle tool
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const taskId = await onlyTaskId(live)

    // When the model tries to confirm a permission binding through it
    // Then the action enum has no such member and the call is rejected
    await expect(call(live, 'task_board_manage', { taskId, action: 'confirm-permission' })).rejects.toThrow()
  })
})

describe('task_board_list and task_board_get', () => {
  it('user lists board cards with their column, lineage and board summary', async () => {
    // Given a board with a root task and one subtask
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', prompt: 'do root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'child', parentId: rootId, prompt: 'do child' })

    // When the user lists every card
    const list = await call(live, 'task_board_list')
    const tasks = list.tasks as Array<{ title: string; parentId?: string; subtaskCount?: number }>
    const board = list.board as { maxSubtaskDepth: number; sessionDefaultPermission: string; counts: Record<string, number> }

    // Then the lineage and the deployment constants are reported
    expect(tasks.map(task => task.title)).toEqual(['root', 'child'])
    expect(tasks[0]?.subtaskCount).toBe(1)
    expect(tasks[1]?.parentId).toBe(rootId)
    expect(board.maxSubtaskDepth).toBe(1)
    expect(board.sessionDefaultPermission).toBe('read-only')
    expect(board.counts.todo).toBe(2)
  })

  it('user reads one card in full and gets a refusal for an unknown id', async () => {
    // Given a board holding one task with a prompt
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', prompt: 'do root' })
    const rootId = await onlyTaskId(live)

    // When the user reads that card and then an unknown id
    const detail = await call(live, 'task_board_get', { taskId: rootId })
    const missing = await call(live, 'task_board_get', { taskId: 'no-such-task' })

    // Then the detail carries the prompt and the miss is a domain refusal
    expect((detail.task as { prompt: string }).prompt).toBe('do root')
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('task-not-found')
  })
})

describe('task_board_create', () => {
  it('user creating a subtask gets the parent execution targets inherited', async () => {
    // Given a parent pinned to a permission and a model
    const live = harness()
    await call(live, 'task_board_create', { title: 'parent', permission: 'workspace-write', model: 'p/m' })
    const parentId = await onlyTaskId(live)

    // When the user creates a subtask without its own targets
    const created = await call(live, 'task_board_create', { title: 'child', parentId })

    // Then the subtask stores the parent model and the link, while the
    // permission is left unset so it can only be inherited while attached
    const task = created.task as { parentId: string; permission?: string; model: string }
    expect(created.ok).toBe(true)
    expect(task.parentId).toBe(parentId)
    expect(task.model).toBe('p/m')
    expect(task.permission).toBeUndefined()
  })

  it('user creating a subtask of a subtask is refused at the default depth', async () => {
    // Given a root with one subtask on a default-depth board
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'child', parentId: rootId })
    const list = await call(live, 'task_board_list')
    const childId = (list.tasks as Array<{ id: string; title: string }>).find(task => task.title === 'child')?.id as string

    // When the user creates a subtask of that subtask
    const refused = await call(live, 'task_board_create', { title: 'grand', parentId: childId })

    // Then the Host refuses it and the board keeps two cards
    expect(refused.ok).toBe(false)
    expect(String(refused.message)).toContain('depth limit (1)')
    expect((await call(live, 'task_board_list')).total).toBe(2)
  })

  it('operator raising the depth limit lets the same subtask of a subtask through', async () => {
    // Given a board configured for two subtask levels
    const live = harness({ maxSubtaskDepth: 2 })
    await call(live, 'task_board_create', { title: 'root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'child', parentId: rootId })
    const list = await call(live, 'task_board_list')
    const childId = (list.tasks as Array<{ id: string; title: string }>).find(task => task.title === 'child')?.id as string

    // When the operator creates the deeper card
    const created = await call(live, 'task_board_create', { title: 'grand', parentId: childId })

    // Then the deeper link is accepted
    expect(created.ok).toBe(true)
    expect((created.task as { parentId: string }).parentId).toBe(childId)
  })
})

describe('task_board_set_parent', () => {
  it('user links an existing card under a parent and detaches it again', async () => {
    // Given a root and a free card
    const live = harness()
    await call(live, 'task_board_create', { title: 'parent' })
    const parentId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'free' })
    const list = await call(live, 'task_board_list')
    const freeId = (list.tasks as Array<{ id: string; title: string }>).find(task => task.title === 'free')?.id as string

    // When the user links, then detaches
    const linked = await call(live, 'task_board_set_parent', { taskId: freeId, parentId })
    const detached = await call(live, 'task_board_set_parent', { taskId: freeId, parentId: '' })

    // Then the link appears and disappears
    expect((linked.task as { parentId?: string }).parentId).toBe(parentId)
    expect((detached.task as { parentId?: string }).parentId).toBeUndefined()
  })
})

describe('task_board_run', () => {
  it('user running a root card starts one session per subtree member', async () => {
    // Given a root with two subtasks
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', prompt: 'do root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'a', parentId: rootId, prompt: 'do a' })
    await call(live, 'task_board_create', { title: 'b', parentId: rootId, prompt: 'do b' })

    // When the user runs the root
    const run = await call(live, 'task_board_run', { taskId: rootId })

    // Then every member is reported as started and the root is a cascade parent
    expect(run.ok).toBe(true)
    expect((run.started as unknown[]).length).toBe(3)
    const detail = await call(live, 'task_board_get', { taskId: rootId })
    const task = detail.task as { latestExecution?: { cascade?: boolean }; subtaskCount?: number }
    expect(task.subtaskCount).toBe(2)
    expect(task.latestExecution?.cascade).toBe(true)
  })

  it('user reading the running cards back sees each session attached', async () => {
    // Given a running cascade
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', prompt: 'do root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'a', parentId: rootId, prompt: 'do a' })
    await call(live, 'task_board_run', { taskId: rootId })

    // When the user lists the running column
    // Then every member has a real session id
    await vi.waitFor(async () => {
      const running = await call(live, 'task_board_list', { status: 'running' })
      const tasks = running.tasks as Array<{ latestExecution?: { sessionId?: string } }>
      expect(tasks.length).toBe(2)
      expect(tasks.every(task => typeof task.latestExecution?.sessionId === 'string')).toBe(true)
    })
  })

  it('user asking to run an unconfirmed elevated card is refused with confirmation-required', async () => {
    // Given a deployment whose session default is workspace-write, one card
    // pinned at that level (allowed) and one above it (unconfirmed)
    const live = harness({ sessionDefaultPermission: 'workspace-write' })
    await call(live, 'task_board_create', { title: 'allowed', permission: 'workspace-write' })
    await call(live, 'task_board_create', { title: 'danger', permission: 'danger-full-access' })
    const list = await call(live, 'task_board_list')
    const dangerId = (list.tasks as Array<{ id: string; title: string }>).find(task => task.title === 'danger')?.id as string

    // When the user runs the gated card
    const run = await call(live, 'task_board_run', { taskId: dangerId })

    // Then the gate refuses it and the card never enters the running column
    expect(run.ok).toBe(false)
    expect(run.code).toBe('confirmation-required')
    const detail = await call(live, 'task_board_get', { taskId: dangerId })
    expect((detail.task as { status: string }).status).toBe('todo')
    expect((detail.task as { permissionPending?: boolean }).permissionPending).toBe(true)
  })

  it('user running a card pinned at the configured session default is allowed through', async () => {
    // Given a deployment whose session default is workspace-write and a card at that level
    const live = harness({ sessionDefaultPermission: 'workspace-write' })
    await call(live, 'task_board_create', { title: 'allowed', permission: 'workspace-write' })
    const taskId = await onlyTaskId(live)

    // When the user runs it
    const run = await call(live, 'task_board_run', { taskId })

    // Then no confirmation is demanded
    expect(run.ok).toBe(true)
    expect((run.started as unknown[]).length).toBe(1)
  })

  it('user whose run carries the calling session id gets it recorded on the execution', async () => {
    // Given a plain card
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', prompt: 'do root' })
    const taskId = await onlyTaskId(live)

    // When the run is issued by an agent session
    await call(live, 'task_board_run', { taskId }, { agent: { session: { id: 'session-claimer' } } })

    // Then the audit stamp names that session
    const detail = await call(live, 'task_board_get', { taskId })
    const executions = (detail.task as { executions: Array<{ initiatedBy?: string }> }).executions
    expect(executions[0]?.initiatedBy).toBe('session-claimer')
  })
})

describe('task_board_manage', () => {
  it('user archiving a parent takes its subtask tree off the board', async () => {
    // Given a root with one subtask
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'child', parentId: rootId })

    // When the user archives the parent and then lists the archive
    await call(live, 'task_board_manage', { taskId: rootId, action: 'archive' })
    const archived = await call(live, 'task_board_list', { includeArchived: true })

    // Then both cards carry the archive stamp and leave the columns
    const tasks = archived.tasks as Array<{ archivedAt?: number }>
    expect(tasks.every(task => task.archivedAt === NOW)).toBe(true)
    expect((await call(live, 'task_board_list')).total).toBe(0)
  })

  it('user deleting a parent that still has subtasks is refused', async () => {
    // Given a root with one subtask
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const rootId = await onlyTaskId(live)
    await call(live, 'task_board_create', { title: 'child', parentId: rootId })

    // When the user deletes the parent
    const removed = await call(live, 'task_board_manage', { taskId: rootId, action: 'delete' })

    // Then the Host refuses and both cards survive
    expect(removed.ok).toBe(false)
    expect(String(removed.message)).toContain('subtasks')
    expect((await call(live, 'task_board_list')).total).toBe(2)
  })

  it('user moving a card to the backlog column sees the new column', async () => {
    // Given a card in the todo column
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const taskId = await onlyTaskId(live)

    // When the user moves it to the backlog
    const moved = await call(live, 'task_board_manage', { taskId, action: 'move-backlog' })

    // Then the card reports the backlog column
    expect(moved.ok).toBe(true)
    expect((moved.task as { status: string }).status).toBe('backlog')
  })
})

describe('task_board_schedule', () => {
  it('user arming a cron schedule sees the next run, and disarming clears it', async () => {
    // Given a plain card
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const taskId = await onlyTaskId(live)

    // When the user arms and then disarms a cron schedule
    const armed = await call(live, 'task_board_schedule', { taskId, enabled: true, cron: '0 9 * * *' })
    const disarmed = await call(live, 'task_board_schedule', { taskId, enabled: false })

    // Then the rule carries its expression and next run, and then stops
    const schedule = armed.schedule as { enabled: boolean; cron: string; nextRunAt?: number }
    expect(schedule.enabled).toBe(true)
    expect(schedule.cron).toBe('0 9 * * *')
    expect(typeof schedule.nextRunAt).toBe('number')
    expect((disarmed.schedule as { enabled: boolean }).enabled).toBe(false)
  })

  it('user arming a schedule on an unknown card is told the card is missing', async () => {
    // Given an empty board
    const live = harness()

    // When the user arms a schedule for a card that does not exist
    const refused = await call(live, 'task_board_schedule', { taskId: 'no-such-task', enabled: true, cron: '0 9 * * *' })

    // Then the refusal names the missing card
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('task-not-found')
  })
})


describe('inherited permission bindings', () => {
  it('user running a subtask under a confirmed parent is allowed through', async () => {
    // Given a parent the human confirmed at danger-full-access and a subtask under it
    const live = harness({ sessionDefaultPermission: 'read-only' })
    await call(live, 'task_board_create', { title: 'parent', permission: 'danger-full-access' })
    const snapshot = live.host.snapshot()
    const parentId = snapshot.tasks[0]?.id as string
    await call(live, 'task_board_create', { title: 'child', parentId })
    const childId = (await call(live, 'task_board_list')).tasks as Array<{ id: string; title: string }>
    const subtaskId = childId.find(task => task.title === 'child')?.id as string
    live.host.apply('human-confirm', { kind: 'confirm-permission', taskId: parentId })

    // When the user runs the subtask
    const run = await call(live, 'task_board_run', { taskId: subtaskId })

    // Then the attached parent binding carries its confirmation to the child
    expect(run.ok).toBe(true)
  })

  it('user running a subtask whose inherited parent binding is unconfirmed is refused', async () => {
    // Given an elevated parent that no human has confirmed, and a subtask under it
    const live = harness({ sessionDefaultPermission: 'read-only' })
    await call(live, 'task_board_create', { title: 'parent', permission: 'danger-full-access' })
    const parentId = live.host.snapshot().tasks[0]?.id as string
    await call(live, 'task_board_create', { title: 'child', parentId })
    const listed = (await call(live, 'task_board_list')).tasks as Array<{ id: string; title: string }>
    const childId = listed.find(task => task.title === 'child')?.id as string

    // When the user runs the subtask
    const run = await call(live, 'task_board_run', { taskId: childId })

    // Then the inherited binding is gated exactly like a directly pinned one
    expect(run.ok).toBe(false)
    expect(run.code).toBe('confirmation-required')
  })

  it('user detaching a subtask with an inherited binding leaves nothing elevated on it', async () => {
    // Given a confirmed elevated parent and a subtask that never pinned its own permission
    const live = harness({ sessionDefaultPermission: 'read-only' })
    await call(live, 'task_board_create', { title: 'parent', permission: 'danger-full-access' })
    const parentId = live.host.snapshot().tasks[0]?.id as string
    await call(live, 'task_board_create', { title: 'child', parentId })
    const listed = (await call(live, 'task_board_list')).tasks as Array<{ id: string; title: string }>
    const childId = listed.find(task => task.title === 'child')?.id as string
    live.host.apply('human-confirm', { kind: 'confirm-permission', taskId: parentId })

    // When the agent detaches the subtask
    await call(live, 'task_board_set_parent', { taskId: childId, parentId: '' })
    const detail = await call(live, 'task_board_get', { taskId: childId })
    const task = detail.task as { parentId?: string; permission?: string; permissionConfirmedAt?: number }

    // Then the card is a root holding neither the binding nor the confirmation,
    // so one confirmed parent cannot mint detached confirmed elevated cards
    expect(task.parentId).toBeUndefined()
    expect(task.permission).toBeUndefined()
    expect(task.permissionConfirmedAt).toBeUndefined()
  })
})

describe('task registration rebinding', () => {
  it('operator whose tool registry provider is replaced gets the tools registered again', () => {
    // Given an activation served by one registry instance
    const live = activate(Config({ enabled: true }), true)
    activations.push(live)
    expect(live.registered).toHaveLength(TASK_BOARD_TOOL_NAMES.length)

    // When cordis unloads that provider fiber and re-runs the injected callback
    live.replaceRegistry()

    // Then the new registry receives the tools instead of the guard short-circuiting
    expect(live.registered).toHaveLength(TASK_BOARD_TOOL_NAMES.length)
  })
})
describe('team-run opt-in through the tools', () => {
  it('user opting a card into an Agent Team sees the mode and a refused run without the service', async () => {
    // Given a fresh board in a deployment that serves no Agent Teams service
    const live = harness()

    // When the model opts a card into team execution
    const created = await call(live, 'task_board_create', { title: 'root', teamRun: true })
    const task = created.task as { id: string; teamRun?: boolean }

    // Then the card records the opt-in
    expect(task.teamRun).toBe(true)

    // And running it is refused by name instead of opening sessions silently
    const refused = await call(live, 'task_board_run', { taskId: task.id })
    expect(refused.ok).toBe(false)
    expect(String(refused.message)).toContain('Agent Teams is unavailable')
  })

  it('user switching a card back to a plain cascade clears the opt-in', async () => {
    // Given a team-mode card
    const live = harness()
    const created = await call(live, 'task_board_create', { title: 'root', teamRun: true })
    const taskId = (created.task as { id: string }).id

    // When the model clears the opt-in
    const updated = await call(live, 'task_board_update', { taskId, teamRun: false })

    // Then the card runs as a plain cascade again
    expect((updated.task as { teamRun?: boolean }).teamRun).toBeUndefined()
  })
})

describe('task_board_update', () => {
  it('user editing one field leaves the other fields untouched', async () => {
    // Given a card with content and a pinned model
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', description: 'keep me', prompt: 'do root', model: 'p/m' })
    const taskId = await onlyTaskId(live)

    // When the user changes only the title
    const updated = await call(live, 'task_board_update', { taskId, title: 'renamed' })

    // Then the title changed and the description, prompt and model survived
    const task = updated.task as { title: string; description: string; prompt: string; model: string }
    expect(task.title).toBe('renamed')
    expect(task.description).toBe('keep me')
    expect(task.prompt).toBe('do root')
    expect(task.model).toBe('p/m')
  })

  it('user clearing the pinned permission with an empty value falls back to the session default', async () => {
    // Given a card pinned to a permission
    const live = harness()
    await call(live, 'task_board_create', { title: 'root', permission: 'workspace-write' })
    const taskId = await onlyTaskId(live)

    // When the user clears the field
    const updated = await call(live, 'task_board_update', { taskId, permission: '' })

    // Then no permission pin remains
    expect((updated.task as { permission?: string }).permission).toBeUndefined()
  })

  it('user submitting an edit with no fields at all gets a refusal', async () => {
    // Given a card
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const taskId = await onlyTaskId(live)

    // When the user submits an empty patch
    const refused = await call(live, 'task_board_update', { taskId })

    // Then nothing is written and the refusal says why
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('nothing-to-change')
  })
})

describe('board switched off', () => {
  it('operator switching the board off makes a tool call fail closed', async () => {
    // Given a card on an active board
    const live = harness()
    await call(live, 'task_board_create', { title: 'root' })
    const taskId = await onlyTaskId(live)

    // When the operator switches the board off and the agent runs the card
    live.host.setConfiguration(false, false)
    const refused = await call(live, 'task_board_run', { taskId })

    // Then the Host refuses the work instead of executing it
    expect(refused.ok).toBe(false)
    expect(String(refused.message)).toContain('disabled')
  })
})

/** The write protocol a volatile reference shares across cosmokit copies. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

interface Activation {
  registered: string[]
  commit: (field: 'enabled', value: boolean) => void
  /** Mimic cordis replacing the injected service's provider fiber. */
  replaceRegistry: () => void
  dispose: () => void
}

/**
 * Activate the real plugin against a capture-only context that serves — or
 * withholds — the optional tool registry, and record the tool registrations.
 */
function activate(config: ReturnType<typeof Config>, registry: boolean): Activation {
  const registered: string[] = []
  const disposers: Array<() => void> = []
  let volatileListener: (() => void) | undefined
  let injectCallback: (() => unknown) | undefined
  let injectDisposer: (() => void) | undefined
  const tools = {
    register: (tool: ToolDefinition) => {
      registered.push(tool.name)
      return () => {
        const index = registered.indexOf(tool.name)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  }
  const callInject = (): void => {
    const dispose = injectCallback?.()
    injectDisposer = typeof dispose === 'function' ? dispose as () => void : undefined
  }
  const ctx = {
    typertGateway: gateway(),
    workspaceRegistry: {},
    agents: { get: () => undefined },
    commands: { execute: async () => undefined },
    get: (name: string) => name === 'tools' && registry ? tools : undefined,
    inject: (names: readonly string[], callback: () => unknown) => {
      if (!names.includes('tools')) return () => {}
      injectCallback = callback
      // Cordis runs the callback once the injected service is available.
      callInject()
      return () => { injectDisposer?.(); injectDisposer = undefined }
    },
    systemPrompt: { section: () => () => {} },
    webServer: { register: () => () => {} },
    effect: (body: () => unknown) => {
      const dispose = body()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
    },
    on: (name: string, listener: () => void) => {
      if (name === 'loader/volatile-update') volatileListener = listener
    },
  }
  apply(ctx as never, config)
  return {
    registered,
    commit: (field, value) => {
      const ref = config[field] as unknown as Record<symbol, (next: unknown) => void>
      ref[VOLATILE_WRITE](value)
      volatileListener?.()
    },
    replaceRegistry: () => {
      // Cordis unloads the provider's dependent fiber (its disposer runs) and
      // then re-runs the callback against the replacement service instance.
      injectDisposer?.()
      injectDisposer = undefined
      registered.splice(0)
      callInject()
    },
    dispose: () => {
      for (const dispose of disposers.splice(0)) dispose()
      injectDisposer?.()
      injectDisposer = undefined
    },
  }
}

describe('tool registration lifecycle', () => {
  it('operator switching the board off unregisters the agent tools and back on restores them', () => {
    // Given an activated board whose runtime serves a tool registry
    const live = activate(Config({ enabled: true }), true)
    activations.push(live)

    // Then every tool is registered
    expect([...live.registered].sort()).toEqual([...TASK_BOARD_TOOL_NAMES].sort())

    // When the operator switches the board off
    live.commit('enabled', false)

    // Then no tool answers, and switching it on registers them again
    expect(live.registered).toHaveLength(0)
    live.commit('enabled', true)
    expect(live.registered).toHaveLength(TASK_BOARD_TOOL_NAMES.length)
  })

  it('operator on a runtime without a tool registry still mounts the board', () => {
    // Given a runtime that serves no tool registry
    const live = activate(Config({ enabled: true }), false)
    activations.push(live)

    // When the activation completes
    // Then it registers nothing and does not fail the mount
    expect(live.registered).toHaveLength(0)
  })
})

describe('optional registry resolution', () => {
  it('operator whose context refuses service lookups gets no registry instead of a crash', () => {
    // Given a capture-only context whose service lookup throws
    const refusing = { get: () => { throw new Error('no service layer') } } as unknown as Context

    // When the registry is resolved
    const registry = resolveToolRegistry(refusing)

    // Then the board degrades to no tools instead of throwing
    expect(registry).toBeUndefined()
  })
})

