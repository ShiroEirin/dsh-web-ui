/** @vitest-environment jsdom */

/**
 * Bulk "install all missing" contract for the Workshop card.
 *
 * The property that matters is the reporting shape: a bulk install is one
 * user gesture, so it must reach the market as ONE request, not one per
 * asset. The downloads themselves stay on the per-asset gateway call so each
 * asset keeps its own failure and its own integrity write.
 *
 * The card reads its installed set from the host route on mount, so the
 * transport is served by a stubbed window.fetch rather than a module mock -
 * the primitive components are stubbed the same way the sibling card test
 * stubs them, because their CSS modules cannot be imported by node.
 *
 * test-standards-allow: no-ad-hoc-mock - the card's own module graph is never
 * patched; only the browser transport and the SDK primitive components are
 * replaced, and the component under test stays the real one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  return {
    Button: (props: Record<string, unknown>) =>
      create('button', { disabled: props['disabled'], onClick: props['onClick'], className: props['className'] }, props['children']),
    Modal: (props: Record<string, unknown>) =>
      props['open'] === true ? create('div', { role: 'dialog' }, props['title'], props['children']) : null,
  }
})

import { MarketCard, type MarketCardProps } from '../src/client/MarketCard.tsx'
import { FakeScope, cardProps } from './market-card.spec.tsx'

/** Two published skins; each test decides which are already on the machine. */
const REMOTE = {
  items: {
    skin: [
      { id: 'miku', name: '初音未来', nameEn: 'Hatsune Miku' },
      { id: 'whale-song', name: '鲸吟', nameEn: 'Whale Song' },
    ],
    pet: [],
    plugin: [],
    preset: [],
  },
  stats: { skin: { miku: 1, 'whale-song': 3 }, pet: {}, plugin: {}, preset: {} },
}

/** The installed set the card reads on mount; each test assigns before rendering. */
let INSTALLED: string[] = []
vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
  const url = String(input)
  if (url.includes('api/market/installed')) {
    return new Response(JSON.stringify({ skins: INSTALLED, pets: [], presets: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Install log plus the counts the market answered with for the whole run. */
interface Run {
  installedIds: string[]
  reportedIds: string[]
  reportCalls: number
}

function mount(
  installed: string[],
  // The gateway override carries the card prop's own type, so the
  // "no gateway" test passes null and the default branch keeps the face's
  // shape; a bare unknown here widens the fallback arm and stops typecheck.
  options: { failFor?: string; gateway?: MarketCardProps['gateway']; reportCounts?: Record<string, number> } = {},
): Run {
  INSTALLED = installed
  const run: Run = { installedIds: [], reportedIds: [], reportCalls: 0 }
  const gateway = options.gateway === undefined
    ? {
        install: async (_kind: string, id: string) => {
          if (options.failFor === id) throw { code: 'write', message: 'disk full' }
          run.installedIds.push(id)
          return { dest: `/home/.dsh/skins/${id}` }
        },
        list: async () => ({ skins: installed, pets: [], presets: [] }),
      }
    : options.gateway
  render(<MarketCard {...cardProps(new FakeScope({}), {
    remote: REMOTE,
    gateway,
    pluginManager: null,
    turnstileToken: async () => 'verified-token',
    marketOrigin: 'https://dsh-market.test',
    reportInstallBatch: async (_kind: string, ids: string[]) => {
      run.reportCalls += 1
      run.reportedIds = ids
      return options.reportCounts ?? Object.fromEntries(ids.map((id) => [id, 1]))
    },
  })} />)
  return run
}

describe('Workshop card: install all missing', () => {
  it('operator arms the bulk action, which then installs only the absent skin', async () => {
    // Given one of the two published skins is already on this machine
    const run = mount(['whale-song'])
    // When the operator taps the bulk action once
    await waitFor(() => expect(screen.getByRole('button', { name: '全部安装' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '全部安装' }))
    // Then the button offers the exact count instead of downloading anything
    await waitFor(() => expect(screen.getByRole('button', { name: /将补装 1 款/ })).toBeTruthy())
    expect(run.installedIds).toEqual([])
  })

  it('operator completing the confirmation installs every absent skin and reports one aggregated event', async () => {
    // Given no published skin is installed yet
    const run = mount([])
    // When the operator arms and then confirms the bulk install
    await waitFor(() => expect(screen.getByRole('button', { name: '全部安装' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '全部安装' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /将补装 2 款/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /将补装 2 款/ }))
    // Then both skins are on disk and the market saw a single aggregated event
    await waitFor(() => expect(screen.getByText(/已安装 2 款皮肤/)).toBeTruthy())
    expect(run.installedIds).toEqual(['miku', 'whale-song'])
    expect(run.reportCalls).toBe(1)
    expect(run.reportedIds).toEqual(['miku', 'whale-song'])
    // The summary rides the same line as the outcome, so one element holds both.
    expect(screen.getByText(/已汇总上报 2 款安装记录/)).toBeTruthy()
  })

  it('operator sees a partial failure reported without the asset that never landed', async () => {
    // Given one skin's download cannot complete
    const run = mount([], { failFor: 'miku' })
    // When the operator runs the bulk install
    await waitFor(() => expect(screen.getByRole('button', { name: '全部安装' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '全部安装' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /将补装 2 款/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /将补装 2 款/ }))
    // Then the failure is on screen and only the landed asset is reported
    await waitFor(() => expect(screen.getByText(/1 款皮肤安装失败/)).toBeTruthy())
    expect(run.reportedIds).toEqual(['whale-song'])
  })

  it('operator with a complete catalog is told so and nothing is downloaded', async () => {
    // Given every published skin is already installed
    const run = mount(['miku', 'whale-song'])
    // When the operator taps the bulk action
    await waitFor(() => expect(screen.getByRole('button', { name: '全部安装' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '全部安装' }))
    // Then the card says there is nothing to do and installs nothing
    await waitFor(() => expect(screen.getByText('所有皮肤均已安装')).toBeTruthy())
    expect(run.installedIds).toEqual([])
  })

  it('operator on a remote browser cannot bulk install because no local gateway answers', async () => {
    // Given the card has no loopback gateway
    mount([], { gateway: null })
    // Then the bulk action is offered but disabled
    await waitFor(() => expect(screen.getByRole('button', { name: '全部安装' })).toBeTruthy())
    const button = screen.getByRole('button', { name: '全部安装' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
