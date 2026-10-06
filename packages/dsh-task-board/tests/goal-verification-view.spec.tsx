// @vitest-environment jsdom
/**
 * Client surface of goal acceptance: the acceptance section of the settings
 * card, the running-column phase label, and the per-execution report.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskBoardSettingsCardController } from '../src/client/TaskBoardSettingsCard.tsx'
import { VerificationReport } from '../src/client/board/VerificationReport.tsx'
import { verificationRunningKey } from '../src/client/board/status-key.ts'
import type { ExecutionVerification } from '../src/core/verification.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
})

/** A bound configuration form over one stored section, as the settings slot hands it over. */
function settingsForm(value: Record<string, unknown>) {
  return {
    getSnapshot: () => ({ status: 'ready' as const, value, base: value, user: value, revision: 1, writable: true, mode: 'host' as const }),
    subscribe: () => () => {},
    mutate: async () => true,
    set: async () => true,
    unset: async () => true,
  }
}

/** One stored acceptance block with a failed first verdict and a passing second one. */
function verification(): ExecutionVerification {
  const route = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
  const criteria = [
    { id: 'specification', name: 'Specification Adherence', score: 0.9, baseline: 0, threshold: 0.65, passed: true },
    { id: 'output_match', name: 'Output Match', score: 0.8, baseline: 0, threshold: 0.65, passed: true },
    { id: 'error_signals', name: 'Error Signal Detection', score: 0.7, baseline: 0, threshold: 0.65, passed: true },
  ]
  const evidence = { chars: 1_234, omittedCharacters: 0, entries: 9, hash: 'abc' }
  return {
    contract: { enabled: true, modelSource: 'inherit', route, preset: 'coding', threshold: 0.65 },
    attempts: [
      {
        index: 1,
        at: 1_700_000_000_100,
        stage: 'quality',
        passed: false,
        score: 0.2,
        baseline: 0,
        criteria: criteria.map(criterion => ({ ...criterion, score: 0.2, passed: false })),
        findings: ['[Output Match evidence=A] the final test run is missing'],
        usage: { calls: 6, inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
        evidence,
        route,
        channel: 'explicit-tag',
        rounds: 2,
      },
      {
        index: 2,
        at: 1_700_000_000_200,
        stage: 'quality',
        passed: true,
        score: 0.8,
        baseline: 0,
        criteria,
        findings: [],
        usage: { calls: 6, inputTokens: 120, outputTokens: 25, reasoningTokens: 6 },
        evidence,
        route,
        channel: 'explicit-tag',
        rounds: 2,
      },
      {
        index: 1,
        at: 1_700_000_000_300,
        stage: 'exception',
        passed: false,
        score: 0,
        baseline: 0,
        criteria: [],
        findings: [],
        usage: { calls: 1, inputTokens: 1, outputTokens: 0, reasoningTokens: 0 },
        evidence,
        route,
        channel: 'explicit-tag',
        rounds: 0,
        error: '验收异常（裁判超时）: the judge request timed out',
      },
    ],
    applicability: 'enforced',
  }
}

/** Render one element into a fresh jsdom root and return its text. */
function render(element: React.ReactElement): string {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container.textContent ?? ''
}

describe('goal acceptance view', () => {
  it('user reading the settings card sees the acceptance section fields and their stored values', () => {
    // Given: a stored configuration with an explicit judge route and level
    const controller = new TaskBoardSettingsCardController(settingsForm({
      goalVerification: false,
      goalVerificationModel: 'deepseek-official/deepseek-flash',
      goalVerificationReasoningEffort: 'high',
    }) as never, async () => false)
    const face = controller.inject()

    // When: the card projects its state
    const state = face.hooks.taskBoardSettingsCard.getSnapshot()

    // Then: every acceptance field is exposed with its stored value, so the
    // section edits the same fields the host schema validates.
    expect(state.goalVerification.text).toBe('false')
    expect(state.goalVerificationModel.text).toBe('deepseek-official/deepseek-flash')
    expect(state.goalVerificationReasoningEffort.text).toBe('high')
    controller.dispose()
  })

  it('user looking at a running goal card sees the acceptance phase instead of a generic running label', () => {
    // Given: executions in each acceptance phase
    const base = verification()

    // When: the card resolves its running label
    const verifying = verificationRunningKey({ ...base, inFlight: true, attempts: [] })
    const repairing = verificationRunningKey(base)
    const off = verificationRunningKey(undefined)

    // Then: verifying and fixing have their own labels while an execution
    // without acceptance keeps the historical one.
    expect(verifying).toBe('running.verifying')
    expect(repairing).toBe('running.verificationPassed')
    expect(off).toBeUndefined()
  })

  it('user reading an execution row sees its verdict, criteria, findings and usage', () => {
    // Given: a stored acceptance block
    const block = verification()

    // When: the report renders in the execution row
    const text = render(<VerificationReport verification={block} />)

    // Then: the verdict, the per-criterion scores with their threshold, the
    // finding, the evidence scope and the token usage are all visible, and the
    // anomaly is distinguished from the quality verdicts.
    expect(text).toContain('验收报告')
    expect(text).toContain('通过')
    expect(text).toContain('Specification Adherence：90.0%（阈值 65.0%）')
    expect(text).toContain('the final test run is missing')
    expect(text).toContain('证据范围：1234 字符')
    expect(text).toContain('输入 221')
    expect(text).toContain('验收异常')
    expect(text).toContain('裁判超时')
  })

  it('user with acceptance disabled for the execution sees no report at all', () => {
    // Given: an execution whose switch was off at start
    const block: ExecutionVerification = {
      ...verification(),
      attempts: [],
      applicability: 'disabled',
      contract: { enabled: false, modelSource: 'inherit', preset: 'coding', threshold: 0.65 },
    }

    // When: the report renders
    const text = render(<VerificationReport verification={block} />)

    // Then: nothing claims the run was verified.
    expect(text).toBe('')
  })

  it('user whose card skipped acceptance sees a report that says so', () => {
    // Given: an execution whose CARD opted out of the gate
    const block: ExecutionVerification = {
      ...verification(),
      attempts: [],
      applicability: 'skipped',
      contract: { enabled: false, modelSource: 'inherit', preset: 'coding', threshold: 0.65 },
    }

    // When: the report renders
    const text = render(<VerificationReport verification={block} />)

    // Then: the run is NOT claimed verified, but the reason is visible and it
    // names the card rather than the board-wide switch.
    expect(text).not.toBe('')
    expect(text).toContain('该任务卡勾选了「跳过验收」')
    expect(text).not.toContain('通过')
  })
})
