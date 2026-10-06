// @vitest-environment jsdom
/**
 * The execution-prompt panel of the GitHub detail seat, as an operator uses
 * it: it tells a templated prompt from a hand-edited or frozen one, shows a
 * fresh analysis and flags a stale one, offers the backlog move when the model
 * judged no change is needed, and sends the analysis actions through the
 * board's dispatch channel (asking for an overwrite only when the prompt was
 * edited).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskBoardExtensionActionRequest } from '../src/core/contract.ts'
import { composeIssuePrompt } from '../src/core/projection.ts'
import { issueSourceHash } from '../src/core/prompt.ts'
import type { TaskRecord } from '../src/core/task-record.ts'
import { resolveRepoConfig, type GitHubTaskMetadata } from '../src/core/types.ts'
import { GitHubDetailSection } from '../src/client/github/sections.tsx'
import { zh } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

beforeEach(() => {
  document.documentElement.lang = 'zh'
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

const config = resolveRepoConfig({ owner: 'deepseek-ai', repository: 'dsh' })
const TITLE = 'Picker follows host'
const BODY = 'The picker must ask the host.'

/** A card whose prompt is exactly what the provider generated, plus overrides. */
function issueCard(github: Partial<GitHubTaskMetadata> = {}, overrides: Partial<TaskRecord> = {}): TaskRecord {
  const analysis = github.analysis
  const { prompt, promptHash } = composeIssuePrompt(
    { number: 15, html_url: 'https://github.com/deepseek-ai/dsh/issues/15', title: TITLE, body: BODY, labels: ['bug'] },
    config,
    analysis,
  )
  return {
    id: 'task-15',
    title: TITLE,
    description: BODY,
    prompt,
    status: 'todo',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    executions: [],
    integrations: {
      github: {
        provider: 'github',
        owner: 'deepseek-ai',
        repository: 'dsh',
        issueNumber: 15,
        issueUrl: 'https://github.com/deepseek-ai/dsh/issues/15',
        remoteTitle: TITLE,
        remoteBody: BODY,
        remoteLabels: ['bug'],
        promptHash,
        ...github,
      },
    },
    ...overrides,
  }
}

/** A stored analysis written from the issue as it currently reads. */
function freshAnalysis(needsCodeChange = true): NonNullable<GitHubTaskMetadata['analysis']> {
  return {
    goal: 'Follow the host capability.',
    steps: ['Inspect pickDir'],
    acceptance: ['pickDir returns unavailable'],
    needsCodeChange,
    sourceHash: issueSourceHash(TITLE, BODY),
    model: 'deepseek/chat',
    generatedAt: 1_700_000_100_000,
  }
}

/** A dispatch channel that records what the panel sent. */
function recordingDispatch(): { dispatch: (request: TaskBoardExtensionActionRequest) => Promise<boolean>; sent: TaskBoardExtensionActionRequest[] } {
  const sent: TaskBoardExtensionActionRequest[] = []
  return { sent, dispatch: async request => { sent.push(request); return true } }
}

/** Render one element into a fresh container. */
function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container
}

/** The button whose text is exactly the given copy. */
function button(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text)
}

describe('GitHub execution prompt panel', () => {
  it('operator generating an analysis sends it through the board channel with the picked model', async () => {
    // Given a card whose prompt is still the generated template
    const channel = recordingDispatch()
    const container = render(<GitHubDetailSection task={issueCard()} dispatch={channel.dispatch} />)
    const panel = container.querySelector('[data-dsh-part="github-prompt"]')
    expect(panel?.textContent).toContain(zh['prompt.analysisNone'])
    expect(panel?.querySelector('[data-prompt-state="edited"]')).toBeNull()

    // When the operator types a model route and asks for an analysis
    const input = panel?.querySelector<HTMLInputElement>('input[type="text"]')
    if (input === null || input === undefined) throw new Error('the model input did not render')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'deepseek/reasoner')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button(container, zh['prompt.generate'])?.click() })

    // Then one analyze action reached the channel, with no overwrite flag
    expect(channel.sent).toEqual([{ extensionId: 'github', action: 'analyze', taskId: 'task-15', payload: { model: 'deepseek/reasoner' } }])
  })

  it('operator whose prompt was edited is told so and must explicitly overwrite', async () => {
    // Given a card whose prompt somebody changed after it was generated
    const channel = recordingDispatch()
    const task = issueCard({}, { prompt: 'My own instructions.' })
    const container = render(<GitHubDetailSection task={task} dispatch={channel.dispatch} />)

    // When the panel renders
    // Then it explains the edit and offers only the overwrite action
    expect(container.querySelector('[data-prompt-state="edited"]')?.textContent).toBe(zh['prompt.edited'])
    expect(button(container, zh['prompt.generate'])).toBeUndefined()
    await act(async () => { button(container, zh['prompt.overwrite'])?.click() })
    expect(channel.sent[0]?.payload).toEqual({ overwrite: true })
  })

  it('operator sees a fresh analysis, and a no-change verdict offers the backlog move', async () => {
    // Given a card carrying a fresh analysis that judged no code change is needed
    const channel = recordingDispatch()
    const container = render(<GitHubDetailSection task={issueCard({ analysis: freshAnalysis(false) })} dispatch={channel.dispatch} />)

    // When the panel renders
    // Then the analysis is shown with its provenance
    const analysis = container.querySelector('[data-dsh-part="github-analysis"]')
    expect(analysis?.textContent).toContain('Follow the host capability.')
    expect(analysis?.textContent).toContain('pickDir returns unavailable')
    expect(container.querySelector('[data-prompt-state="fresh"]')?.textContent).toContain('deepseek/chat')
    expect(container.querySelector('[data-prompt-state="no-code-change"]')?.textContent).toContain(zh['prompt.noCodeChange'])

    // When the operator moves the card to the backlog
    await act(async () => { button(container, zh['prompt.moveBacklog'])?.click() })

    // Then the move travels through the channel
    expect(channel.sent).toEqual([{ extensionId: 'github', action: 'move-backlog', taskId: 'task-15', payload: {} }])
  })

  it('operator sees an analysis written before the issue changed flagged as stale', () => {
    // Given an analysis whose source no longer matches the issue
    const stale = { ...freshAnalysis(), sourceHash: issueSourceHash(TITLE, 'an older body') }
    const task = issueCard({}, {})
    const github = task.integrations?.github as Record<string, unknown>
    const withStale: TaskRecord = { ...task, integrations: { github: { ...github, analysis: stale } } }

    // When the panel renders
    const container = render(<GitHubDetailSection task={withStale} dispatch={async () => true} />)

    // Then the analysis is reported stale, not displayed, and can be regenerated
    expect(container.querySelector('[data-prompt-state="stale"]')?.textContent).toBe(zh['prompt.analysisStale'])
    expect(container.querySelector('[data-dsh-part="github-analysis"]')).toBeNull()
    expect(button(container, zh['prompt.regenerate'])?.disabled).toBe(false)
  })

  it('operator sees progress while an analysis runs and the failure reason after one fails', () => {
    // Given one card with an analysis in flight and one whose analysis failed
    const pending = render(<GitHubDetailSection task={issueCard({ analysisPendingSince: 1 })} dispatch={async () => true} />)
    const failed = render(<GitHubDetailSection task={issueCard({ analysisError: 'quota exceeded' })} dispatch={async () => true} />)

    // When both render
    // Then the pending card disables the action, and the failed one shows its reason
    expect(pending.querySelector('[data-prompt-state="pending"]')?.textContent).toBe(zh['prompt.analysisPending'])
    expect(button(pending, zh['prompt.analysisPending'])?.disabled).toBe(true)
    expect(failed.textContent).toContain('quota exceeded')
  })

  it('operator viewing a card that already ran sees the prompt frozen with no analysis controls', () => {
    // Given a card with an execution
    const task = issueCard({}, { executions: [{ id: 'exec-1', startedAt: 1 }] })

    // When the panel renders
    const container = render(<GitHubDetailSection task={task} dispatch={async () => true} />)

    // Then it says the prompt is frozen and offers nothing to change it
    expect(container.textContent).toContain(zh['prompt.frozen'])
    expect(button(container, zh['prompt.generate'])).toBeUndefined()
    expect(container.querySelector('[data-dsh-part="github-prompt"] input')).toBeNull()
  })
})
