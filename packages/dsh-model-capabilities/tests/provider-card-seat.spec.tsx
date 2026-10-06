/** @vitest-environment jsdom */

/**
 * The provider-card seat claim and the notice it drives.
 *
 * `settings.models.provider-card` is a keyed cell that renders ONE entry, so
 * two plugins extending pi-ai provider cards collide by construction: the
 * registry refuses the second claim and the losing panel used to disappear
 * into a catch block. These tests pin the reported outcome instead — a named
 * conflict the Models page shows, and the panel coming back on its own once
 * the occupant releases the cell.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DisabledProvidersFooter } from '../src/client/DisabledProvidersFooter.tsx'
import {
  PI_AI_PROVIDER_CARD_KEY,
  PROVIDER_CARD_SEAT,
  claimProviderCardSeat,
  type ProviderCardSeatContext,
} from '../src/client/provider-card-seat.ts'
import type { RefreshBus, SettingsNamespaceFace } from '../src/client/settings-face.ts'

afterEach(() => {
  cleanup()
})

/** One registration as the registry ledger holds it. */
interface LedgerEntry {
  options: { name: string, key?: string, priority?: number }
  registrant?: string
  release: () => void
}

/**
 * A slot registry double that enforces the rule this plugin must survive: a
 * keyed cell holds one entry per priority, and a second entry at an occupied
 * cell is refused. `occupy` seeds the cell with another plugin's card, the way
 * a third-party provider-card extension would.
 */
function registry(occupy?: { registrant: string }): {
  ctx: ProviderCardSeatContext
  ledger: LedgerEntry[]
  /** Release the seeded occupant and notify subscribers, as its disposer does. */
  releaseOccupant: () => void
} {
  const ledger: LedgerEntry[] = []
  const listeners: Array<() => void> = []
  const add = (options: { name: string, key?: string, priority?: string }, registrant?: string): (() => void) => {
    const key = options.key
    if (key !== undefined && ledger.some((entry) => entry.options.key === key && (entry.options.priority ?? 0) === 0)) {
      throw new Error(`keyed slot "${PROVIDER_CARD_SEAT}" already has an entry for key "${key}" at priority 0 (registered by ${registrant ?? 'unknown'})`)
    }
    const entry: LedgerEntry = {
      options: { name: options.name, key, ...(options.priority === undefined ? {} : { priority: Number(options.priority) }) },
      registrant,
      release: () => {
        const index = ledger.indexOf(entry)
        if (index >= 0) ledger.splice(index, 1)
        for (const listener of [...listeners]) listener()
      },
    }
    ledger.push(entry)
    for (const listener of [...listeners]) listener()
    return entry.release
  }
  if (occupy !== undefined) {
    add({ name: PROVIDER_CARD_SEAT, key: PI_AI_PROVIDER_CARD_KEY }, occupy.registrant)
  }
  const ctx: ProviderCardSeatContext = {
    slots: {
      register: (options: never, component: never) => add(options as { name: string, key?: string }),
      inject: (seat: never, callback: () => () => void) => {
        const release = callback()
        return release
      },
      subscribe: (_seat: never, listener: () => void) => {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      entries: () => ledger,
    },
  }
  return {
    ctx,
    ledger,
    releaseOccupant: () => {
      const occupant = ledger.find((entry) => entry.registrant === occupy?.registrant)
      occupant?.release()
    },
  }
}

/** The panel this module registers (erased: the seat owns its props type). */
const Panel = (): null => null

describe('claimProviderCardSeat', () => {
  it('operator gets the capability panel on every pi-ai card while the cell is free', () => {
    // Given a Models page whose provider-card cell nobody occupies
    const harness = registry()

    // When the plugin claims the cell
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })

    // Then the panel is seated under the pi-ai key at the default priority,
    // and the Models page is told the claim succeeded
    expect(harness.ledger).toHaveLength(1)
    expect(harness.ledger[0].options).toMatchObject({ name: PROVIDER_CARD_SEAT, key: PI_AI_PROVIDER_CARD_KEY })
    expect(status.getSnapshot()).toEqual({ kind: 'claimed' })
  })

  it('operator is told which plugin holds the cell instead of losing the panel silently', () => {
    // Given a third-party plugin already occupying the pi-ai card cell
    const harness = registry({ registrant: 'dsh-codearts-auth' })

    // When this plugin claims the same cell
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })

    // Then the Models page names the occupant rather than rendering nothing
    expect(status.getSnapshot()).toEqual({ kind: 'conflict', occupant: 'dsh-codearts-auth' })
    expect(harness.ledger.map((entry) => entry.registrant)).toEqual(['dsh-codearts-auth'])
  })

  it('operator gets the capability panel back once the occupying plugin is unloaded', () => {
    // Given a claim refused by another plugin still holding the cell
    const harness = registry({ registrant: 'dsh-codearts-auth' })
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })

    // When that plugin unloads, releasing the cell
    harness.releaseOccupant()

    // Then this plugin claims it without a DSH restart
    expect(status.getSnapshot()).toEqual({ kind: 'claimed' })
    expect(harness.ledger.map((entry) => entry.options.key)).toEqual([PI_AI_PROVIDER_CARD_KEY])
  })

  it('operator keeps the panel claim after another plugin registers an unrelated card cell', () => {
    // Given a claim already held by this plugin
    const harness = registry()
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })

    // When some other plugin claims a different key of the same slot
    harness.ledger.push({
      options: { name: PROVIDER_CARD_SEAT, key: 'llm-deepseek' },
      release: () => {},
    })

    // Then this plugin keeps the cell it holds and re-registers nothing
    expect(status.getSnapshot()).toEqual({ kind: 'claimed' })
    expect(harness.ledger.filter((entry) => entry.options.key === PI_AI_PROVIDER_CARD_KEY)).toHaveLength(1)
  })
})

describe('DisabledProvidersFooter conflict notice', () => {
  /** A settings face that serves no archive entry: only the notice renders. */
  function emptyFace(): SettingsNamespaceFace {
    return {
      describe: () => Promise.resolve({
        ok: true,
        value: { writable: true, hasDocument: true, namespaces: [] },
      }) as never,
      mutate: () => Promise.resolve({ ok: false, error: { code: 'unused', message: 'unused' } }) as never,
    }
  }

  /** A refresh bus no footer interaction can reach in this scenario. */
  function idleBus(): RefreshBus {
    return { subscribe: () => () => {}, notify: () => {} }
  }

  it('operator sees why the model capabilities panel is missing', () => {
    // Given a deployment whose pi-ai card cell is held by another plugin
    const harness = registry({ registrant: 'dsh-codearts-auth' })
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })

    // When the Models page footer renders
    render(<DisabledProvidersFooter settings={emptyFace()} refresh={idleBus()} cardSeat={status} />)

    // Then it reports the collision and names the occupant
    expect(screen.getByRole('alert').textContent).toContain('dsh-codearts-auth')
    expect(status.getSnapshot()).toEqual({ kind: 'conflict', occupant: 'dsh-codearts-auth' })
  })

  it('operator sees no notice once the panel is mounted again', () => {
    // Given a claim that recovered after the occupant was unloaded
    const harness = registry({ registrant: 'dsh-codearts-auth' })
    const status = claimProviderCardSeat(harness.ctx, { component: Panel })
    harness.releaseOccupant()

    // When the Models page footer renders the recovered claim
    const { container } = render(<DisabledProvidersFooter settings={emptyFace()} refresh={idleBus()} cardSeat={status} />)

    // Then the Models page carries no collision notice
    expect(container.querySelector('[data-dsh-part="disabled-footer"]')).toBeNull()
    expect(status.getSnapshot()).toEqual({ kind: 'claimed' })
  })
})
