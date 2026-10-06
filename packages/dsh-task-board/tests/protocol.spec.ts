import { describe, expect, it } from 'vitest'
import { TAG_NAME_MAX_LENGTH, createTask } from '../src/core/tasks.ts'
import { parseActionEnvelope } from '../src/protocol.ts'

describe('task-board action protocol', () => {
  it('accepts the versioned action union and rejects unknown executable fields', () => {
    expect(parseActionEnvelope({
      requestId: 'request-a',
      action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } },
    })?.action.kind).toBe('create')
    expect(parseActionEnvelope({
      requestId: 'request-b',
      action: { kind: 'update', taskId: 'task-a', patch: { command: 'powercfg /x' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'request-c',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { cron: '* * * * *', nextRunAt: 1 } },
    })).toBeUndefined()
  })

  it('operator setting a schedule zone gets it carried, and an unusable one rejected', () => {
    // Given a resolvable zone, a clearing null and unusable names
    // When each action envelope is parsed
    // Then the resolvable zone and the null survive and the bad names do not
    expect(parseActionEnvelope({
      requestId: 'zone-set',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { cron: '0 9 * * *', timeZone: 'Asia/Shanghai' } },
    })?.action).toEqual({ kind: 'set-schedule', taskId: 'task-a', patch: { cron: '0 9 * * *', timeZone: 'Asia/Shanghai' } })
    expect(parseActionEnvelope({
      requestId: 'zone-clear',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: null } },
    })?.action).toEqual({ kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: null } })
    // An unknown zone never reaches the Host.
    expect(parseActionEnvelope({
      requestId: 'zone-bad',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: 'Not/AZone' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'zone-empty',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: '' } },
    })).toBeUndefined()
  })

  it('operator creating a card with a zone gets it accepted, and an unusable one rejected', () => {
    // Given a valid and an unknown creation-time zone
    // When each create envelope is parsed
    // Then only the valid zone produces a create action
    expect(parseActionEnvelope({
      requestId: 'create-zone',
      action: {
        kind: 'create', id: 'task-zone',
        input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Europe/London' } },
      },
    })?.action.kind).toBe('create')
    expect(parseActionEnvelope({
      requestId: 'create-zone-bad',
      action: {
        kind: 'create', id: 'task-zone-bad',
        input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Nowhere/Nope' } },
      },
    })).toBeUndefined()
  })

  it('accepts a task-content update patch (host rejects the blank title)', () => {
    expect(parseActionEnvelope({
      requestId: 'content-update',
      action: { kind: 'update', taskId: 'task-a', patch: { title: 'B', description: 'd', prompt: 'p' } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'content-update-blank',
      action: { kind: 'update', taskId: 'task-a', patch: { title: '' } },
    })?.action.kind).toBe('update')
  })

  it('accepts model pinning in create input and update patch (#1359)', () => {
    const createEnv = parseActionEnvelope({
      requestId: 'create-with-model',
      action: {
        kind: 'create',
        id: 'task-model',
        input: {
          title: 'Model task',
          description: '',
          prompt: 'prompt',
          model: 'deepseek-official/deepseek-v4-flash',
        },
      },
    })
    expect(createEnv?.action.kind).toBe('create')

    const updateEnv = parseActionEnvelope({
      requestId: 'update-with-model',
      action: {
        kind: 'update',
        taskId: 'task-model',
        patch: {
          model: 'openai/gpt-5-preview',
        },
      },
    })
    expect(updateEnv?.action.kind).toBe('update')

    // Rejects non-string model values
    expect(parseActionEnvelope({
      requestId: 'update-with-bad-model',
      action: {
        kind: 'update',
        taskId: 'task-model',
        patch: {
          model: 12345,
        },
      },
    })).toBeUndefined()
  })

  it('accepts the session-reuse opt-in in create input and update patch (#1419)', () => {
    expect(parseActionEnvelope({
      requestId: 'create-reuse',
      action: { kind: 'create', id: 'task-reuse', input: { title: 'R', description: '', prompt: 'p', reuseSession: true } },
    })?.action.kind).toBe('create')

    // false (and null) clear the opt-in; anything else is rejected outright.
    expect(parseActionEnvelope({
      requestId: 'update-reuse-off',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: false } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-reuse-null',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: null } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-reuse-bad',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: 'yes' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'create-reuse-bad',
      action: { kind: 'create', id: 'task-reuse', input: { title: 'R', description: '', prompt: 'p', reuseSession: 1 } },
    })).toBeUndefined()
  })

  it('accepts benign future import fields but rejects executable command fields', () => {
    const valid = createTask({ title: 'A', description: '', prompt: '' }, 1, 'task-a')
    expect(parseActionEnvelope({ requestId: 'ok', action: { kind: 'import', sourceId: 'browser', tasks: [valid] } })).toBeDefined()
    expect(parseActionEnvelope({ requestId: 'bad', action: {
      kind: 'import', sourceId: 'browser', tasks: [{ ...valid, shell: 'cmd.exe' }],
    } })).toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'future', action: {
      kind: 'import', sourceId: 'browser', tasks: [{ ...valid, futureDisplayHint: 'compact' }],
    } })?.action.kind).toBe('import')
  })

  it('rejects oversized request ids', () => {
    expect(parseActionEnvelope({
      requestId: 'x'.repeat(257),
      action: { kind: 'delete', taskId: 'task-a' },
    })).toBeUndefined()
  })

  it('rejects malformed schedule fields during legacy import', () => {
    const task = createTask({ title: 'legacy', description: '', prompt: '' }, 1, 'legacy')
    expect(parseActionEnvelope({
      requestId: 'import-a',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, cron: ['* * * * *'] } }] },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'import-b',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, cron: '* * * * *', nextRunAt: Number.NaN } }] },
    })).toBeUndefined()
  })

  it('operator sending the /goal opt-out through create and update gets it accepted', () => {
    // Given create input and update patches that carry the goal option
    // When the envelopes are parsed
    // Then the boolean is accepted in both, and anything else is refused
    expect(parseActionEnvelope({
      requestId: 'create-goal-off',
      action: { kind: 'create', id: 'task-goal', input: { title: 'G', description: '', prompt: 'p', goalRun: false } },
    })?.action.kind).toBe('create')

    // The opt-out is tri-state: true (or null) returns the card to its default.
    expect(parseActionEnvelope({
      requestId: 'update-goal-off',
      action: { kind: 'update', taskId: 'task-goal', patch: { goalRun: false } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-goal-on',
      action: { kind: 'update', taskId: 'task-goal', patch: { goalRun: null } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-goal-bad',
      action: { kind: 'update', taskId: 'task-goal', patch: { goalRun: 'no' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'create-goal-bad',
      action: { kind: 'create', id: 'task-goal', input: { title: 'G', description: '', prompt: 'p', goalRun: 0 } },
    })).toBeUndefined()
  })

  it('user importing legacy tasks keeps the /goal opt-out on the imported card', () => {
    // Given a legacy card that opted out of goal runs
    const task = { ...createTask({ title: 'legacy', description: '', prompt: '' }, 1, 'legacy'), goalRun: false }

    // When it is imported
    const parsed = parseActionEnvelope({ requestId: 'import-goal', action: { kind: 'import', sourceId: 'browser-a', tasks: [task] } })

    // Then the imported card carries the same opt-out
    expect(parsed?.action.kind).toBe('import')
    if (parsed?.action.kind !== 'import') throw new Error('expected an import action')
    expect(parsed.action.tasks[0].goalRun).toBe(false)
  })
})

describe('label management actions', () => {
  it('operator renaming a label on the wire gets it carried, and a blank or over-long name rejected', () => {
    // Given a rename envelope, a blank name and a name past the tag cap
    // When each is parsed
    // Then only the well-formed rename survives
    const accepted = parseActionEnvelope({
      requestId: 'rename-tag',
      action: { kind: 'rename-tag', from: 'ship', to: 'release' },
    })
    expect(accepted?.action.kind).toBe('rename-tag')
    expect(accepted?.action).toMatchObject({ from: 'ship', to: 'release' })
    expect(parseActionEnvelope({
      requestId: 'rename-tag-blank',
      action: { kind: 'rename-tag', from: 'ship', to: '   ' },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'rename-tag-long',
      action: { kind: 'rename-tag', from: 'ship', to: 'x'.repeat(TAG_NAME_MAX_LENGTH + 1) },
    })).toBeUndefined()
  })

  it('operator deleting a label on the wire gets it carried, and an unnamed or extra-keyed action rejected', () => {
    // Given a delete envelope, a blank name and an action carrying an unknown key
    // When each is parsed
    // Then only the well-formed delete survives
    const accepted = parseActionEnvelope({
      requestId: 'delete-tag',
      action: { kind: 'delete-tag', name: 'ship' },
    })
    expect(accepted?.action.kind).toBe('delete-tag')
    expect(parseActionEnvelope({
      requestId: 'delete-tag-blank',
      action: { kind: 'delete-tag', name: '' },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'delete-tag-extra',
      action: { kind: 'delete-tag', name: 'ship', taskId: 'task-a' },
    })).toBeUndefined()
  })
})

