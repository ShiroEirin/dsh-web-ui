/** @vitest-environment jsdom */

/**
 * The shared entry-bound settings form: which profile entry id the fallback
 * binds, and when it rebinds.
 *
 * Under the 0.1.7 settings model a form is addressed by PROFILE ENTRY ID, while
 * a family card knows only its namespace. The describe mirror that names the
 * served row answers asynchronously, so a one-shot guess is wrong for some
 * deployment: binding the bare namespace fails every save on an aggregate
 * install ("No configurable plugin entry"), and binding the aggregate row id
 * fails a standalone one. This module starts on the most likely row and
 * re-resolves when the mirror answers.
 */
import { describe, expect, it, vi } from 'vitest'
import { createServedEntryForm } from '../src/client/settings-entry-form.ts'

/** The row ids the aggregate install serves for one package, most likely first. */
const ENTRY_IDS = ['web-ui-example', 'ui-example', 'example'] as const

/** One fake form the service hands out; its snapshot reports the entry it serves. */
function fakeForm(entryId: string) {
  const listeners = new Set<() => void>()
  return {
    entryId,
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { enabled: true },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
}

/**
 * A shared forms service double over a mutable mirror answer.
 * @param rows - the namespace rows the mirror reports; undefined models an unanswered mirror.
 */
function service(rows?: string[]) {
  const requests: string[] = []
  const mirrorListeners = new Set<() => void>()
  const state = { rows }
  const forms = {
    get: vi.fn((entryId: string) => {
      requests.push(entryId)
      return fakeForm(entryId)
    }),
    describe: () => ({
      getSnapshot: () => (state.rows === undefined
        ? { status: 'idle' as const, view: undefined, error: null }
        : {
            status: 'ready' as const,
            view: { namespaces: state.rows.map(ns => ({ ns })), writable: true, hasDocument: true },
            error: null,
          }),
      subscribe: (listener: () => void) => {
        mirrorListeners.add(listener)
        return () => { mirrorListeners.delete(listener) }
      },
    }),
  }
  return {
    forms,
    requests,
    /** Publish a new mirror answer the way the shared mirror does on a document update. */
    answer: (next: string[]) => {
      state.rows = next
      for (const listener of [...mirrorListeners]) listener()
    },
  }
}

describe('createServedEntryForm', () => {
  it('user whose mirror has not answered yet gets the first candidate row bound', () => {
    // Given a cold start where the describe mirror holds no answer
    const { forms, requests } = service()
    // When the fallback form is created
    createServedEntryForm({ forms, entryIds: ENTRY_IDS })
    // Then it binds the most likely row rather than the bare namespace
    expect(requests).toEqual(['web-ui-example'])
  })

  it('user whose mirror answers the aggregate row keeps one binding', () => {
    // Given a mirror that already names the aggregate row
    const { forms, requests, answer } = service(['web-ui-example'])
    createServedEntryForm({ forms, entryIds: ENTRY_IDS })
    // When the mirror republishes the same answer
    answer(['web-ui-example'])
    // Then no second form is requested, because the id did not move
    expect(requests).toEqual(['web-ui-example'])
  })

  it('user on a standalone install is rebound to the standalone row once the mirror answers', () => {
    // Given a cold start, where the first binding is the aggregate row by default
    const { forms, requests, answer } = service()
    createServedEntryForm({ forms, entryIds: ENTRY_IDS })
    expect(requests).toEqual(['web-ui-example'])
    // When the mirror answers with this profile's own standalone row
    answer(['ui-example'])
    // Then the form is rebound onto that row instead of keeping a dead entry id
    expect(requests).toEqual(['web-ui-example', 'ui-example'])
  })

  it('user of a profile serving none of this package rows gets the bare namespace bound', () => {
    // Given a mirror that explicitly answers with other packages' rows
    const { forms, requests } = service(['web-ui-other', 'web-ui-someone-else'])
    // When the fallback form is created
    createServedEntryForm({ forms, entryIds: ENTRY_IDS })
    // Then the namespace itself is addressed, the pre-0.1.7 keying shape
    expect(requests).toEqual(['example'])
  })

  it('user whose mirror read is refused keeps the first candidate row', () => {
    // Given a mirror that throws instead of answering
    const { forms } = service()
    forms.describe = () => ({
      getSnapshot: () => { throw new Error('mirror unavailable') },
      subscribe: () => () => {},
    })
    const requests: string[] = []
    const refusing = {
      get: (entryId: string) => { requests.push(entryId); return fakeForm(entryId) },
      describe: forms.describe,
    }
    // When the fallback form is created
    const form = createServedEntryForm({ forms: refusing as never, entryIds: ENTRY_IDS })
    // Then the refusal is treated as unanswered, not as absence
    expect(requests).toEqual(['web-ui-example'])
    expect(form.getSnapshot().status).toBe('ready')
  })

  it('user whose mirror answers an empty document keeps the first candidate row', () => {
    // Given a mirror that answered with no namespace at all
    const { forms, requests } = service([])
    // When the fallback form is created
    createServedEntryForm({ forms, entryIds: ENTRY_IDS })
    // Then the empty answer is not read as "this package serves nothing"
    expect(requests).toEqual(['web-ui-example'])
  })

  it('user gets the bound form snapshot forwarded through the wrapper', () => {
    // Given a bound fallback form
    const { forms } = service(['web-ui-example'])
    const form = createServedEntryForm<{ enabled: boolean }>({ forms, entryIds: ENTRY_IDS })
    // When the card reads the wrapper
    // Then it sees the delegated entry's own snapshot
    expect(form.getSnapshot().value).toEqual({ enabled: true })
    expect(form.getSnapshot().status).toBe('ready')
  })

  it('user whose write reaches the wrapper lands on the bound entry form', async () => {
    // Given a bound fallback form over the aggregate row
    const { forms } = service(['web-ui-example'])
    const form = createServedEntryForm<{ enabled: boolean }>({ forms, entryIds: ENTRY_IDS })
    // When the card writes through the wrapper
    // Then the write is delegated to that entry's form
    await expect(form.set('enabled', false)).resolves.toBe(true)
    await expect(form.unset('enabled')).resolves.toBe(true)
    await expect(form.mutate([])).resolves.toBe(true)
  })
})
