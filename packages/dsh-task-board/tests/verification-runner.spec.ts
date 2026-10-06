import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinishReason, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { collectEvidence, runAcceptance } from '../src/host/verification-runner.ts'

afterEach(() => { vi.useRealTimers() })

function harness(replies: { text?: string; reason: FinishReason }[]) {
  const budgets: number[] = []
  const llm = {
    prepareCall: async (config: { maxTokens: number }) => {
      const index = budgets.push(config.maxTokens) - 1
      return { config, stream: async function* (): AsyncIterable<StreamChunk> {
        const reply = replies[Math.min(index, replies.length - 1)]!
        if (reply.text !== undefined) yield { type: 'text-delta', index: 0, text: reply.text }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 } }
        yield { type: 'finish', reason: reply.reason }
      } }
    },
  } as unknown as LlmRuntime
  const run = () => runAcceptance({ llm, route: { provider: 'test', model: 'judge' },
    evidence: collectEvidence({}, 'test work', 0), threshold: 0.65, index: 1, signal: new AbortController().signal, now: () => 100 })
  return { budgets, run }
}
const valid = '<score_A>A</score_A><score_B>T</score_B>'

describe('judge stream recovery', () => {
  it('operator given reasoning exhausts the cap, when retried, then keeps the configured cap and records all billed calls', async () => {
    vi.useFakeTimers()
    // Given a typed provider stream.
    const h = harness([{ reason: { kind: 'max-tokens' } }, { text: valid, reason: { kind: 'stop' } }])
    // When acceptance consumes the stream and its bounded retries.
    const pending = h.run()
    await vi.runAllTimersAsync()
    const { attempt } = await pending
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets.slice(0, 3)).toEqual([16384, 16384, 16384])
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.stage).toBe('quality')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.usage).toEqual({ calls: 7, inputTokens: 70, outputTokens: 35, reasoningTokens: 7 })
  })

  it.each(['', 'missing score tags'])('operator given unusable text %j, when a later answer is valid, then recovers within the same acceptance', async text => {
    vi.useFakeTimers()
    // Given a typed provider stream.
    const h = harness([{ text, reason: { kind: 'stop' } }, { text: valid, reason: { kind: 'stop' } }])
    // When acceptance consumes the stream and its bounded retries.
    const pending = h.run()
    await vi.runAllTimersAsync()
    // Then the recorded verdict and billing reflect the stream outcome.
    expect((await pending).attempt.stage).toBe('quality')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toHaveLength(7)
  })

  it('operator given persistent truncation with score tags, when the budget ends, then refuses instead of scoring partial output', async () => {
    vi.useFakeTimers()
    // Given a typed provider stream.
    const h = harness([{ text: valid, reason: { kind: 'max-tokens' } }])
    // When acceptance consumes the stream and its bounded retries.
    const pending = h.run()
    await vi.runAllTimersAsync()
    const { attempt } = await pending
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toEqual([16384, 16384, 16384])
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.stage).toBe('exception')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.passed).toBe(false)
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain('output ceiling (16384 tokens)')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.usage.calls).toBe(3)
  })

  it.each([401, 403])('operator given HTTP %i, when the SDK finishes with error, then preserves authentication failure without retrying', async status => {
    // Given a typed provider stream.
    const h = harness([{ reason: { kind: 'error', failure: { code: 'AUTH', status, message: 'invalid credential' } } }])
    // When acceptance consumes the terminal failure.
    const { attempt } = await h.run()
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain('鉴权失败')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain(String(status))
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toEqual([16384])
  })

  it('operator given a transient terminal error, when retried, then recovers and flags incomplete usage', async () => {
    vi.useFakeTimers()
    // Given a typed provider stream.
    const h = harness([{ reason: { kind: 'error', failure: { code: 'SERVER', status: 503, message: 'unavailable' } } }, { text: valid, reason: { kind: 'stop' } }])
    // When acceptance consumes the stream and its bounded retries.
    const pending = h.run()
    await vi.runAllTimersAsync()
    const { attempt } = await pending
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.stage).toBe('quality')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.usage.usageIncomplete).toBe(true)
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toHaveLength(7)
  })

  it('operator given persistent empty answers, when retries are exhausted, then records exactly three calls', async () => {
    vi.useFakeTimers()
    // Given a typed provider stream.
    const h = harness([{ reason: { kind: 'stop' } }])
    // When acceptance consumes the stream and its bounded retries.
    const pending = h.run()
    await vi.runAllTimersAsync()
    const { attempt } = await pending
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.stage).toBe('exception')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain('empty answer')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.usage.calls).toBe(3)
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toEqual([16384, 16384, 16384])
  })

  it('operator given a terminal error containing a credential, when reported, then redacts it', async () => {
    // Given a typed provider stream.
    const h = harness([{ reason: { kind: 'error', failure: { code: 'AUTH', status: 401, message: 'token=private-test-value' } } }])
    // When acceptance consumes the terminal failure.
    const { attempt } = await h.run()
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain('[REDACTED]')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).not.toContain('private-test-value')
  })

  it('operator given cancellation after valid-looking text, when the stream ends, then refuses without retrying', async () => {
    // Given a typed provider stream.
    const h = harness([{ text: valid, reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } }])
    // When acceptance consumes the terminal failure.
    const { attempt } = await h.run()
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.stage).toBe('exception')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(attempt.error).toContain('验收被取消')
    // Then the recorded verdict and billing reflect the stream outcome.
    expect(h.budgets).toHaveLength(1)
  })
})
