/**
 * Issue #1816: the family's one detach mechanism for side effects that rewrite
 * an HMR-watched file from inside a Host mutation.
 *
 * The Host wraps a mutation in `hmr.runExclusive`, which marks the running
 * async context with an AsyncLocalStorage store. The first fix for the same
 * failure in this family deferred the write with a bare `setImmediate` on the
 * belief that it starts a fresh store. These tests pin down that this belief is
 * false, and that `runDetached` - the mechanism that replaced it - genuinely
 * starts clean. `packages/dsh-plugin-manager` now carries the same copy for
 * its own set-enabled write.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it } from 'vitest'
import { runDetached } from '../src/host/detached-work.ts'

/** The mark a Host mutation inside hmr.runExclusive leaves on its context. */
const transaction = new AsyncLocalStorage<string>()

/** Resolve on the next macrotask, so timer-scoped context has settled. */
function tick(): Promise<void> {
  return new Promise(resolve => { setImmediate(resolve) })
}

describe('detaching the set-enabled write from the HMR transaction (issue #1816)', () => {
  it('operator sees a plain deferral still carry the transaction mark', async () => {
    // Given a mutation that holds an exclusive transaction
    // When it defers the write with a bare setImmediate
    // Then the deferred work still observes the transaction, which is why
    // deferring alone could never keep the patch write out of the watcher
    const observed: Array<string | undefined> = []
    await new Promise<void>((resolve) => {
      transaction.run('mutation', () => {
        setImmediate(() => {
          observed.push(transaction.getStore())
          resolve()
        })
      })
    })
    expect(observed).toEqual(['mutation'])
  })

  it('operator sees the detached scheduler start without the transaction mark', async () => {
    // Given a mutation that holds an exclusive transaction
    // When it schedules the write through runDetached
    // Then the scheduled work observes no transaction at all
    const observed: Array<string | undefined> = []
    await new Promise<void>((resolve) => {
      transaction.run('mutation', () => {
        runDetached(() => setImmediate(() => {
          observed.push(transaction.getStore())
          resolve()
        }))
      })
    })
    expect(observed).toEqual([undefined])
  })

  it('operator sees work deferred from detached work stay detached', async () => {
    // Given detached work that itself defers again
    // When the inner deferral runs
    // Then it inherits the detached context rather than the transaction, so a
    // nested timer cannot silently reintroduce the mark
    const observed: Array<string | undefined> = []
    await new Promise<void>((resolve) => {
      transaction.run('mutation', () => {
        runDetached(() => setImmediate(() => {
          observed.push(transaction.getStore())
          setImmediate(() => {
            observed.push(transaction.getStore())
            resolve()
          })
        }))
      })
    })
    expect(observed).toEqual([undefined, undefined])
  })

  it('operator keeps the transaction on the caller after scheduling detached work', async () => {
    // Given a mutation holding its transaction
    // When it schedules a detached write
    // Then the caller still sees its own transaction: detaching the write must
    // never strip the mutation of the context it runs in
    const seen: Array<string | undefined> = []
    await new Promise<void>((resolve) => {
      transaction.run('mutation', () => {
        runDetached(() => setImmediate(() => { resolve() }))
        seen.push(transaction.getStore())
      })
    })
    await tick()
    expect(seen).toEqual(['mutation'])
  })
})
