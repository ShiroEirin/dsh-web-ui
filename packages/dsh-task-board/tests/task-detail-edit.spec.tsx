// @vitest-environment jsdom
/**
 * Issue #1110: the detail overlay offers editing of task content (title,
 * description, prompt) only while the task has never started executing.
 * Running and settled tasks fail closed — no edit affordance — and the edit
 * modal saves through the controller only after validating the title.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { TaskUpdatePatch } from '../src/core/use-cases/task-update.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Task A', description: 'desc', prompt: 'do it' }, 0, 't1'),
    ...overrides,
  }
}

function controllerFake(
  taskRecord: TaskRecord,
  updateTask: (id: string, patch: TaskUpdatePatch) => Promise<boolean> = async () => true,
  teamRunAvailable = true,
): { controller: BoardController; snapshot: ControllerSnapshot } {
  const snapshot: ControllerSnapshot = {
    tasks: [taskRecord],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: taskRecord.id,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      sessionDefaultPermission: 'read-only',
      teamRunAvailable,
    },
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    closeTask: vi.fn(),
    retryHostSync: vi.fn(async () => true),
    openSession: vi.fn(),
    updateTask,
    moveTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    restoreTask: vi.fn(),
    rerunTask: vi.fn(async () => {}),
    setSchedule: vi.fn(() => true),
    isHostBacked: () => false,
  } as unknown as BoardController
  return { controller, snapshot }
}

async function renderDetail(
  taskRecord: TaskRecord,
  updateTask?: (id: string, patch: TaskUpdatePatch) => Promise<boolean>,
  teamRunAvailable = true,
): Promise<{ container: HTMLElement; controller: BoardController; snapshot: ControllerSnapshot }> {
  const { controller, snapshot } = controllerFake(taskRecord, updateTask, teamRunAvailable)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<TaskDetail controller={controller} task={taskRecord} />) })
  return { container, controller, snapshot }
}

function editButtonOf(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(button => button.textContent === '编辑')
}

function teamToggleOf(container: HTMLElement): HTMLInputElement | undefined {
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  return boxes.find(input => input.closest('label')?.textContent?.includes('Agent Team'))
}

function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}


describe('Agent Team opt-in in the execution settings', () => {
  it('user enabling team execution on a served deployment saves the opt-in', async () => {
    // Given a task on a deployment that serves Agent Teams
    const updates: TaskUpdatePatch[] = []
    const { container } = await renderDetail(task(), async (id, patch) => { updates.push(patch); return true })
    const toggle = teamToggleOf(container)
    if (toggle === undefined) throw new Error('no Agent Team toggle')

    // When the user ticks it
    expect(toggle.disabled).toBe(false)
    await act(async () => { toggle.click() })

    // Then the opt-in is written through the controller
    expect(updates).toEqual([{ teamRun: true }])
  })

  it('operator on a deployment without Agent Teams sees the toggle disabled with the reason', async () => {
    // Given a task on a deployment that serves no Agent Teams service
    const { container } = await renderDetail(task(), undefined, false)
    const toggle = teamToggleOf(container)

    // When the user inspects the execution settings
    // Then the opt-in is offered read-only and the reason is stated
    expect(toggle?.disabled).toBe(true)
    expect(container.textContent).toContain('当前部署未提供 Agent Teams 服务')
  })
})
describe('task content editing before execution (issue #1110)', () => {
  it('offers the edit button for a task that has never executed', async () => {
    const { container } = await renderDetail(task())
    const editButton = editButtonOf(container)
    expect(editButton).toBeDefined()
    await act(async () => { editButton!.click() })
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })

  it('hides the edit button for a running task', async () => {
    const { container } = await renderDetail(task({
      status: 'running',
      executions: [{ id: 'e-run', sessionId: undefined, startedAt: 1, endedAt: undefined, result: undefined, error: undefined }],
    }))
    expect(editButtonOf(container)).toBeUndefined()
  })

  it('hides the edit button for a settled task', async () => {
    const { container } = await renderDetail(task({
      status: 'done',
      executions: [{ id: 'e-done', sessionId: undefined, startedAt: 1, endedAt: 2, result: 'succeeded', error: undefined }],
    }))
    expect(editButtonOf(container)).toBeUndefined()
  })

  it('saves edited content through the controller and closes', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    const title = dialog!.querySelector('input') as HTMLInputElement
    const textareas = dialog!.querySelectorAll('textarea')
    expect(title.value).toBe('Task A')
    expect(textareas[0].value).toBe('desc')
    expect(textareas[1].value).toBe('do it')

    await act(async () => {
      setFieldValue(title, 'Renamed')
      setFieldValue(textareas[0] as HTMLTextAreaElement, 'new desc')
      setFieldValue(textareas[1] as HTMLTextAreaElement, 'new prompt')
    })

    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(updateTask).toHaveBeenCalledOnce()
    expect(updateTask).toHaveBeenCalledWith('t1', { title: 'Renamed', description: 'new desc', prompt: 'new prompt' })
    // The save closes the overlay on its exit leg: the surface leaves once its
    // reversible exit transition has run, not on the click's own tick.
    await vi.waitFor(() => {
      expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).toBeNull()
    })
  })

  it('keeps the modal open and does not save a blank title', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    await act(async () => { setFieldValue(dialog!.querySelector('input') as HTMLInputElement, '   ') })
    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(updateTask).not.toHaveBeenCalled()
    expect(container.textContent).toContain('标题不能为空')
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })

  it('stays open with the Host error when the update is rejected', async () => {
    const { container, snapshot } = await renderDetail(task(), async () => {
      snapshot.transportError = 'task has already been executed'
      return false
    })
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(container.textContent).toContain('task has already been executed')
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })
})

describe('session reuse toggle (#1419)', () => {
  function reuseCheckbox(container: HTMLElement): HTMLInputElement {
    const label = [...container.querySelectorAll('label')].find(node => node.textContent?.includes('在同一对话继续'))
    expect(label).toBeDefined()
    return label!.querySelector('input') as HTMLInputElement
  }

  it('starts unchecked and opts the task in through the controller', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    const checkbox = reuseCheckbox(container)
    expect(checkbox.checked).toBe(false)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { reuseSession: true })
  })

  it('shows an opted-in task as checked and clears the opt-in on unclick', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task({ reuseSession: true }), updateTask)
    const checkbox = reuseCheckbox(container)
    expect(checkbox.checked).toBe(true)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { reuseSession: false })
  })
})

describe('goal run toggle', () => {
  function goalCheckbox(container: HTMLElement): HTMLInputElement {
    const label = [...container.querySelectorAll('label')].find(node => node.textContent?.includes('以 dsh 内置的 /goal 开始执行任务'))
    if (label === undefined) throw new Error('no /goal option in the detail view')
    return label.querySelector('input') as HTMLInputElement
  }

  it('user opening a card that never touched the option sees it checked and unchecking pins a plain turn', async () => {
    // Given a card that never touched the option (absent = on by default)
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)

    // When the detail view renders it
    const checkbox = goalCheckbox(container)

    // Then the checkbox shows the default, and unchecking writes the opt-out
    expect(checkbox.checked).toBe(true)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { goalRun: false })
  })

  it('user changing the schedule zone persists it through the controller', async () => {
    // Given a card whose rule is pinned to a zone
    const { container, controller } = await renderDetail(task({
      schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Asia/Shanghai', nextRunAt: undefined, lastTriggeredAt: undefined },
    }))

    // When the user picks a different zone and then the Host default
    const zoneSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === '时区')!
    expect(zoneSelect.value).toBe('Asia/Shanghai')
    await act(async () => {
      zoneSelect.value = 'Europe/London'
      zoneSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      zoneSelect.value = ''
      zoneSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Then each choice is written as an action, and clearing sends null
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { timeZone: 'Europe/London' })
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { timeZone: null })
  })

  it('user opening an opted-out card sees it unchecked and re-checking restores the default', async () => {
    // Given a card that stored the /goal opt-out
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task({ goalRun: false }), updateTask)

    // When the detail view renders it
    const checkbox = goalCheckbox(container)

    // Then it shows unchecked, and re-checking writes the default back
    expect(checkbox.checked).toBe(false)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { goalRun: true })
  })
})
