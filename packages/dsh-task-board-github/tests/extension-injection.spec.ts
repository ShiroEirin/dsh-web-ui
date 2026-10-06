/**
 * The provider's wiring under a REAL cordis registry.
 *
 * This suite exists because of a real defect: the aggregate mounts plugin
 * children without ordering their applies, so the board's `taskBoard` service
 * is frequently published AFTER this extension activates. A one-shot
 * "resolve it now, and give up forever if it is missing" lookup left every seat
 * permanently absent under a real aggregate load, with nothing but a console
 * warning to show for it.
 *
 * The wiring therefore lives behind a cordis dependency scope. These cases
 * drive that scope through a real `Context`: the board service is published
 * and withdrawn with `provide`, and every assertion is about what the operator
 * ends up with — seats, provider registrations, tools and published summaries.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { installGitHubClientHalf, type ExtensionEnabledSource } from '../src/client/github/extension.ts'
import { apply, Config } from '../src/index.ts'
import { FakeBoard } from './support/fake-board.ts'
import { mountPlugin, recordingClientFace, recordingSlots, settle } from './support/cordis-harness.ts'

/**
 * The seats the extension contributes, in registration order. The board's
 * settings seat is deliberately absent: the repository/credential summary is
 * part of this extension's own settings card.
 */
const SEAT_NAMES = [
  'task-board.detail.section',
  'task-board.card.decoration',
]

/** The repository slugs the running provider publishes in its summary. */
function summaryRepositories(board: FakeBoard): string[] {
  const summary = board.published.github as { repositories?: Array<{ owner: string; repository: string }> } | undefined
  return (summary?.repositories ?? []).map(entry => entry.owner + '/' + entry.repository)
}

/** A live switch of the kind the settings form owns. */
interface Switchboard {
  source: ExtensionEnabledSource
  read(): boolean
  set(next: boolean): void
}

/**
 * Build a switchable enabled source.
 * @param initial - the switch's starting position.
 * @returns the source, its current value, and a setter that notifies listeners.
 */
function switchboard(initial: boolean): Switchboard {
  let live = initial
  const listeners = new Set<() => void>()
  return {
    source: {
      read: () => live,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    read: () => live,
    set: (next) => {
      live = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('GitHub client wiring against a late board service', () => {
  it('operator gets both provider seats once the board publishes its client service, and loses them when it goes away', async () => {
    // Given a page whose board has not published its client service yet
    const root = new Context()
    const slots = recordingSlots()
    root.provide('slots', slots.service as never)
    const board = recordingClientFace()
    const wanted = switchboard(true)
    const dispose = installGitHubClientHalf(root as never, wanted.source)
    await settle()

    // When the extension's own switch is on but the board serves nothing
    // Then no seat is registered, and the extension is not a dead end
    expect(slots.seats).toEqual([])

    // When the board publishes its client service
    const unprovide = root.provide('taskBoard', board.face as never)
    await settle()

    // Then every seat and the visibility predicate are registered under this
    // extension's id
    expect(slots.seats.map(seat => seat['name'])).toEqual(SEAT_NAMES)
    expect(slots.seats.every(seat => seat['id'] === 'github')).toBe(true)
    expect(board.visibility).toHaveLength(1)

    // When the board withdraws the service again
    await unprovide()
    await settle()

    // Then every contribution was released with it
    expect(slots.seats).toEqual([])
    expect(board.visibility).toEqual([])
    dispose()
  })

  it('operator turning the extension on after the board is already served still gets the seats', async () => {
    // Given a page where the board published its client service before this
    // extension's own switch was turned on
    const root = new Context()
    const slots = recordingSlots()
    root.provide('slots', slots.service as never)
    const board = recordingClientFace()
    root.provide('taskBoard', board.face as never)
    const wanted = switchboard(false)
    const dispose = installGitHubClientHalf(root as never, wanted.source)
    await settle()

    // When the switch is still off
    // Then nothing is contributed
    expect(slots.seats).toEqual([])

    // When the operator turns the switch on
    wanted.set(true)
    await settle()

    // Then the seats appear without any board-side change
    expect(slots.seats.map(seat => seat['name'])).toEqual(SEAT_NAMES)
    dispose()
  })
})

describe('GitHub host wiring against a late board service', () => {
  it('operator gets the provider and its seven tools once the board publishes its registration service, and loses them when it goes away', async () => {
    // Given a host whose board has not published its registration service yet
    const root = new Context()
    const board = new FakeBoard()
    const mounted = await mountPlugin(root, ctx => { apply(ctx as never, Config({ enabled: true })) })
    await settle()

    // When the enabled extension has no board to register with
    // Then nothing of it runs
    expect(board.toolNames).toEqual([])
    expect(board.isActive('github')).toBe(false)

    // When the board publishes its registration service
    const unprovide = root.provide('taskBoard', board.hostFace() as never)
    await settle()

    // Then the provider is admitted with its nine tools and its published summary
    expect(board.isActive('github')).toBe(true)
    expect(board.toolNames).toHaveLength(9)
    expect(Object.keys(board.published)).toEqual(['github'])

    // When the board withdraws the service
    await unprovide()
    await settle()

    // Then the provider is released, its tools unregistered and its summary cleared
    expect(board.isActive('github')).toBe(false)
    expect(board.toolNames).toEqual([])
    expect(board.published).toEqual({})
    await mounted.dispose()
  })

  it('operator starting with the board already served gets the provider registered at once', async () => {
    // Given a host whose board service is already served
    const root = new Context()
    const board = new FakeBoard()
    root.provide('taskBoard', board.hostFace() as never)

    // When the enabled row activates
    const mounted = await mountPlugin(root, ctx => { apply(ctx as never, Config({ enabled: true })) })
    await settle()

    // Then the provider is admitted without waiting for anything else
    expect(board.isActive('github')).toBe(true)
    expect(board.toolNames).toHaveLength(9)
    await mounted.dispose()
  })

  it('operator starting with the extension switched off registers nothing even when the board is served', async () => {
    // Given a board already serving its registration service
    const root = new Context()
    const board = new FakeBoard()
    root.provide('taskBoard', board.hostFace() as never)

    // When a disabled row activates
    const mounted = await mountPlugin(root, ctx => { apply(ctx as never, Config({ enabled: false })) })
    await settle()

    // Then the board was handed no provider at all
    expect(board.isActive('github')).toBe(false)
    expect(board.toolNames).toEqual([])
    expect(Object.keys(board.published)).toEqual([])
    await mounted.dispose()
  })

  it('operator adding a repository while the provider runs reaches it without a restart', async () => {
    // Given a wired provider serving one repository, whose row the Loader
    // commits volatile edits into in place
    const root = new Context()
    const board = new FakeBoard()
    root.provide('taskBoard', board.hostFace() as never)
    const live: Array<{ owner: string; repository: string }> = [{ owner: 'deepseek-ai', repository: 'dsh-web' }]
    const config = { ...Config({}), repositories: { get: () => live } }
    const mounted = await mountPlugin(root, ctx => { apply(ctx as never, config as never) })
    await settle()
    expect(summaryRepositories(board)).toEqual(['deepseek-ai/dsh-web'])

    // When the settings surface stores a second repository and the Loader
    // announces the committed change
    live.push({ owner: 'other-org', repository: 'other-repo' })
    await mounted.ctx.emit('loader/volatile-update', [['repositories']])
    await settle()

    // Then the running provider serves both, so the write needed no restart
    expect(summaryRepositories(board)).toEqual(['deepseek-ai/dsh-web', 'other-org/other-repo'])
    await mounted.dispose()
  })

  it('operator switching the extension off after it was wired releases the provider, its tools and its summary', async () => {
    // Given a wired provider whose row carries a live master switch
    let live = true
    const root = new Context()
    const board = new FakeBoard()
    root.provide('taskBoard', board.hostFace() as never)
    const config = { ...Config({}), enabled: { get: () => live } }
    const mounted = await mountPlugin(root, ctx => { apply(ctx as never, config as never) })
    await settle()
    expect(board.isActive('github')).toBe(true)

    // When the Loader commits the switch off and announces the change
    live = false
    await mounted.ctx.emit('loader/volatile-update', [['enabled']])
    await settle()

    // Then the provider is released with everything it had registered
    expect(board.isActive('github')).toBe(false)
    expect(board.toolNames).toEqual([])
    expect(board.published).toEqual({})
    await mounted.dispose()
  })
})
