/**
 * The restart verdict and its execution. The mode decides whether a plugin
 * update can be made effective in place (a relaunch), must be handed to the
 * packaged Desktop shell that owns the process tree, or cannot be done at all;
 * every case is asserted on the returned mode, not on a string in a message.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  performRestart,
  planRestart,
  RESTART_EXIT_DELAY_MS,
  type RelaunchCommand,
  type RestartFacts,
} from '../src/host/restart.ts'

/** Launch facts for a plain interactive CLI run. */
function facts(overrides: Partial<RestartFacts> = {}): RestartFacts {
  return {
    env: {},
    execPath: '/usr/local/bin/node',
    argv: ['/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'],
    execArgv: [],
    cwd: '/Users/example/work',
    interactive: true,
    ...overrides,
  }
}

describe('restart planning', () => {
  it('operator on a packaged Desktop host: the shell that owns the process tree carries the restart', () => {
    // Given a host the packaged Desktop launcher booted
    const launch = facts({ desktop: true })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then this process only stops: Electron offers its own relaunch
    expect(plan.mode).toBe('shell')
    expect(plan.command).toBeUndefined()
  })

  it('operator on an Electron-spawned host without the desktop fact gets the shell restart', () => {
    // Given a host whose environment marks it as an Electron child
    const launch = facts({ env: { ELECTRON_RUN_AS_NODE: '1' }, interactive: false })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the shell owns it, not a detached respawn
    expect(plan.mode).toBe('shell')
  })

  it('operator on a terminal launch: the host re-executes its own command line', () => {
    // Given an interactive CLI run with an extra runtime flag
    const launch = facts({ execArgv: ['--enable-source-maps'] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the replacement runs the same interpreter, script and arguments
    expect(plan.mode).toBe('relaunch')
    expect(plan.command).toEqual({
      execPath: '/usr/local/bin/node',
      argv: [
        '--enable-source-maps',
        '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
        'web',
      ],
      cwd: '/Users/example/work',
      env: {},
    } satisfies RelaunchCommand)
  })

  it('operator restarting a launch with inspector flags: they are dropped from the replacement', () => {
    // Given a launch carrying inspector flags
    const launch = facts({ execArgv: ['--inspect=127.0.0.1:9229', '--trace-warnings'] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the port-binding flags are gone and everything else survives
    expect(plan.command?.argv).toEqual([
      '--trace-warnings',
      '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      'web',
    ])
  })

  it('operator on a supervised launch without a terminal: nothing is restarted', () => {
    // Given a host started by something that watches it (piped stdio)
    const launch = facts({ interactive: false })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then no replacement is created and this process keeps serving
    expect(plan.mode).toBe('manual')
  })

  it('operator on a launch with no script in argv: nothing is restarted', () => {
    // Given a host whose argv carries no entry script
    const launch = facts({ argv: [] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then there is no command line to re-execute
    expect(plan).toEqual({ mode: 'manual' })
  })
})

describe('restart execution', () => {
  it('operator carrying out a manual plan: nothing is spawned and nothing exits', () => {
    // Given a manual verdict
    const exit = vi.fn()
    const schedule = vi.fn()

    // When it is carried out
    const mode = performRestart({ mode: 'manual' }, { exit, schedule })

    // Then nothing is spawned and nothing is scheduled to exit
    expect(mode).toBe('manual')
    expect(schedule).not.toHaveBeenCalled()
  })

  it('operator carrying out a shell plan: the process exits after the answer can flush', () => {
    // Given a shell verdict
    const exit = vi.fn()
    const schedule = vi.fn((run: () => void) => { run() })
    const startHelper = vi.fn(() => true)

    // When it is carried out
    const mode = performRestart({ mode: 'shell' }, { exit, schedule, startHelper })

    // Then the process exits on the restart delay, with no helper spawned
    expect(mode).toBe('shell')
    expect(startHelper).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), RESTART_EXIT_DELAY_MS)
    expect(exit).toHaveBeenCalled()
  })

  it('operator carrying out a relaunch plan: the helper starts before the process exits', () => {
    // Given a relaunch verdict
    const command: RelaunchCommand = { execPath: '/usr/local/bin/node', argv: ['web'], cwd: '/work', env: {} }
    const exit = vi.fn()
    const startHelper = vi.fn(() => true)
    const schedule = vi.fn((run: () => void) => { run() })

    // When it is carried out
    const mode = performRestart({ mode: 'relaunch', command }, { exit, schedule, startHelper })

    // Then the helper was started with that command and the process exits
    expect(mode).toBe('relaunch')
    expect(startHelper).toHaveBeenCalledWith(command)
    expect(exit).toHaveBeenCalled()
  })

  it('operator carrying out a relaunch plan whose helper cannot start: it degrades to manual', () => {
    // Given a relaunch verdict whose helper cannot be created
    const command: RelaunchCommand = { execPath: '/usr/local/bin/node', argv: ['web'], cwd: '/work', env: {} }
    const exit = vi.fn()
    const schedule = vi.fn()

    // When it is carried out
    const mode = performRestart({ mode: 'relaunch', command }, { exit, schedule, startHelper: () => false })

    // Then this process stays up and reports that a human must restart
    expect(mode).toBe('manual')
    expect(schedule).not.toHaveBeenCalled()
  })
})
