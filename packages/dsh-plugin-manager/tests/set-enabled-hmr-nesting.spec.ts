/**
 * Issue #1816: the plugin page's enable/disable toggle failed with
 * "HMR transactions cannot be nested", and `cordis.patch.yml` was never
 * written.
 *
 * The write happens on the async context of a Host `hmr.runExclusive`
 * transaction, and `cordis.patch.yml` is exactly the file the HMR config
 * watcher refreshes from. While that transaction is still open - the official
 * manager keeps working after the write - the watcher's refresh re-enters
 * `runExclusive`, which rejects with "HMR transactions cannot be nested".
 *
 * The fix routes the write through the family's `runDetached`, the
 * module-scope AsyncResource that really does start clean. A bare
 * `setImmediate` is NOT enough: Node propagates the AsyncLocalStorage store
 * into timers, promise continuations and AsyncResources scoped to the current
 * async id, which is pinned in tests/detached-work.spec.ts. This file pins the
 * placement rule that keeps the write off the caller's context at all.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'host', 'routes.ts'), 'utf8')

/**
 * The body of the `setEnabledHandler` arrow function, found by brace balance
 * from its opening brace.
 * @returns the handler body source, without the closing brace.
 */
function setEnabledBody(): string {
  const head = /const setEnabledHandler = async \(req: IncomingMessage, res: ServerResponse\): Promise<void> => \{/
  const match = head.exec(source)
  if (match === null) throw new Error('no setEnabledHandler declaration in src/host/routes.ts')
  const start = match.index + match[0].length - 1
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start + 1, i)
    }
  }
  throw new Error('unbalanced braces after setEnabledHandler')
}

describe('the set-enabled patch write vs. the HMR transaction (issue #1816)', () => {
  it('operator sees the patch write leave the caller async context', () => {
    // Given the host handler that persists an enable/disable override
    // When its write site is read
    // Then the write is scheduled through runDetached rather than issued
    // directly on the transaction's context, which is what let the HMR config
    // watcher re-enter runExclusive and refuse the toggle
    const body = setEnabledBody()
    expect(body).toContain('runDetached(')
    expect(body).toContain('writePatchAtomic(')
    // The detachment must wrap the scheduling, not sit inside the deferred
    // callback: by the time the callback runs, the timer has already captured
    // the caller's context.
    expect(body.indexOf('runDetached(')).toBeLessThan(body.indexOf('setImmediate('))
  })

  it('operator still gets the real write outcome in the toggle response', () => {
    // Given the detached write
    // When the handler builds its response
    // Then it is awaited, so a failed write rejects the toggle and the
    // snapshot below it is read from the persisted text rather than racing it
    const body = setEnabledBody()
    expect(body).toContain('await runDetached(')
    const write = body.indexOf('await runDetached(')
    const snapshot = body.indexOf('snapshotGateway(facts, next)')
    expect(write).toBeGreaterThan(-1)
    expect(snapshot).toBeGreaterThan(write)
  })

  it('operator keeps the current-vs-desired guard around the write', () => {
    // Given a settled profile whose toggle changes nothing
    // When the handler runs
    // Then no write is issued at all, so a no-op toggle cannot wake the watcher
    const body = setEnabledBody()
    const guard = body.indexOf('if (next !== patchText)')
    const write = body.indexOf('writePatchAtomic(')
    expect(guard).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(guard)
  })
})
