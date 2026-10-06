// @vitest-environment jsdom
/**
 * The GitHub surfaces as an operator sees them: the task-detail seat, the card
 * decoration, the repository/credential block of the extension's own settings
 * card, and the dispatch channel the detail actions travel over. The board's
 * own generic filter and its visibility summation are covered by the board's
 * suite; here the provider's contribution to each is asserted directly.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskBoardExtensionActionRequest } from '../src/core/contract.ts'
import type { TaskRecord } from '../src/core/task-record.ts'
import { GitHubSettingsSection, type GitHubSettingsSectionProps, type GitHubSettingsCardState } from '../src/client/GithubSettingsCard.tsx'
import { GitHubCardDecoration, GitHubDetailSection } from '../src/client/github/sections.tsx'
import { setSummary, clearSummary } from '../src/client/github/summary.ts'
import { isGitHubTaskVisible } from '../src/client/github/visibility.ts'
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
  clearSummary()
})

/** One task record with the GitHub integration the case under test needs. */
function fakeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-gh-ui',
    title: 'GitHub UI Task',
    description: 'Detailed description',
    prompt: 'Prompt text',
    status: 'todo',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    executions: [],
    ...overrides,
  }
}

/** One complete, writable section snapshot whose two switches are untouched. */
function cardState(enabledText = ''): GitHubSettingsCardState {
  const field = { text: '', overridden: false, invalid: false }
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    enabled: { ...field, text: enabledText },
    announceToAgent: field,
  }
}

/** Render-ready props for the section: a fixed snapshot and inert form actions. */
function cardProps(enabledText = ''): GitHubSettingsSectionProps {
  const state = cardState(enabledText)
  return {
    t: (key: string) => (zh as Record<string, string>)[key] ?? key,
    useGithubSettingsCard: (select: (snapshot: GitHubSettingsCardState) => unknown) => select(state),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
  } as unknown as GitHubSettingsSectionProps
}

/** A dispatch channel that records what the seats sent and accepts everything. */
function recordingDispatch(): { dispatch: (request: TaskBoardExtensionActionRequest) => Promise<boolean>; sent: TaskBoardExtensionActionRequest[] } {
  const sent: TaskBoardExtensionActionRequest[] = []
  return {
    sent,
    dispatch: async (request) => {
      sent.push(request)
      return true
    },
  }
}

/** Render one element into a fresh container and return it. */
function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container
}

/**
 * Open a settings card's disclosure, which every settings card starts closed
 * with: the card renders its rows only once the operator expands it.
 * @param container - the container the card rendered into.
 * @returns the header button that was toggled.
 */
function expandSettingsCard(container: HTMLElement): HTMLButtonElement {
  const header = container.querySelector<HTMLButtonElement>('button[aria-expanded]')
  if (header === null) throw new Error('the settings card disclosure did not render')
  act(() => { header.click() })
  return header
}

describe('GitHub UI integration', () => {
  it('operator reads the issue, its labels and its pull request from the provider detail seat', () => {
    // Given a card backed by a GitHub issue carrying ten labels and an open draft PR
    const task = fakeTask({
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh',
          issueNumber: 123,
          issueUrl: 'https://github.com/deepseek-ai/dsh/issues/123',
          remoteState: 'open',
          remoteLabels: ['dsh', 'bug', 'frontend', 'p1', 'ready', 'docs', 'release', 'team:ui', 'label-9', 'label-10'],
          lastSyncedAt: 1_700_000_050_000,
          pullRequest: {
            number: 456,
            url: 'https://github.com/deepseek-ai/dsh/pull/456',
            state: 'open',
            draft: true,
            headBranch: 'feat/gh-integration',
            baseBranch: 'main',
          },
        },
      },
    })

    // When the detail seat renders it
    const container = render(<GitHubDetailSection task={task} dispatch={async () => true} />)

    // Then the section is anchored for skins, names the issue, and shows every
    // label (ten, beyond the native eight-tag limit) and the PR
    const section = container.querySelector('[data-dsh-part="github-integration"]')
    expect(section?.querySelector('[data-dsh-part="github-link"]')?.textContent).toContain('deepseek-ai/dsh #123')
    expect(section?.querySelectorAll('[data-dsh-part="github-label"]')).toHaveLength(10)
    const pull = section?.querySelector('[data-dsh-part="github-pr"]')
    expect(pull?.textContent).toContain('PR #456')
    expect(pull?.textContent).toContain('feat/gh-integration → main')
  })

  it('operator sees why a card whose issue lost the inclusion label is deactivated', () => {
    // Given an imported card whose remote issue dropped the inclusion label
    const task = fakeTask({
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh',
          issueNumber: 999,
          issueUrl: 'https://github.com/deepseek-ai/dsh/issues/999',
          remoteLabels: [],
          deactivated: true,
        },
      },
    })

    // When the detail seat renders it
    const container = render(<GitHubDetailSection task={task} dispatch={async () => true} />)

    // Then the seat explains the deactivation instead of looking broken
    const section = container.querySelector('[data-dsh-part="github-integration"]')
    expect(section?.textContent).toContain(zh['detail.deactivated'])
  })

  it('operator creating a pull request sends the action through the board dispatch channel', async () => {
    // Given a linked card whose detail seat rendered with a recording channel
    const task = fakeTask({
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh',
          issueNumber: 321,
          issueUrl: 'https://github.com/deepseek-ai/dsh/issues/321',
          remoteLabels: ['dsh'],
        },
      },
    })
    const channel = recordingDispatch()
    const container = render(<GitHubDetailSection task={task} dispatch={channel.dispatch} />)

    // When the operator opens the create-PR dialog and submits the prefilled branch
    const openButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === zh['detail.createPr'])
    if (openButton === undefined) throw new Error('the create-PR button did not render')
    act(() => { openButton.click() })
    const form = container.querySelector('[role="dialog"]')
    const submit = Array.from(form?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === zh['detail.createPr'])
    await act(async () => { submit?.click() })

    // Then exactly one action reached the channel, naming the extension, the
    // action, the card and the provider's own payload
    expect(channel.sent).toEqual([{
      extensionId: 'github',
      action: 'create-pr',
      taskId: task.id,
      payload: { headBranch: 'issue-321', baseBranch: 'main', draft: false },
    }])
  })

  it('operator sees the provider visibility predicate hide a deactivated issue and keep a normal card', () => {
    // Given one ordinary card and one deactivated GitHub-backed card
    const activeTask = fakeTask({ id: 'active-1', title: 'Active Task' })
    const deactivatedTask = fakeTask({
      id: 'deactivated-1',
      title: 'Deactivated Task',
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh',
          issueNumber: 99,
          issueUrl: 'https://github.com/deepseek-ai/dsh/issues/99',
          remoteLabels: [],
          deactivated: true,
        },
      },
    })

    // When the provider's own visibility rule judges both
    const activeVisible = isGitHubTaskVisible(activeTask)
    const deactivatedVisible = isGitHubTaskVisible(deactivatedTask)

    // Then only the ordinary card stays on the board's active columns
    expect(activeVisible).toBe(true)
    expect(deactivatedVisible).toBe(false)
  })

  it('operator sees the card decoration name the linked issue number', () => {
    // Given a card linked to issue 1758
    const task = fakeTask({
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh-web',
          issueNumber: 1758,
          issueUrl: 'https://github.com/deepseek-ai/dsh-web/issues/1758',
          remoteLabels: ['dsh'],
        },
      },
    })

    // When the card-decoration seat renders it
    const container = render(<GitHubCardDecoration task={task} />)

    // Then the badge is an inline link to the issue that opens in a new tab
    const badge = container.querySelector('[data-dsh-part="github-badge"]')
    expect(badge?.textContent).toBe('#1758')
    expect(badge?.tagName).toBe('A')
    expect(badge?.getAttribute('href')).toBe('https://github.com/deepseek-ai/dsh-web/issues/1758')
    expect(badge?.getAttribute('target')).toBe('_blank')
    expect(badge?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(badge?.getAttribute('title')).toContain('deepseek-ai/dsh-web#1758')
  })

  it('operator sees a plain badge, never a link, when the stored issue URL is not http(s)', () => {
    // Given a card whose stored issue URL uses a script scheme
    const task = fakeTask({
      integrations: {
        github: {
          provider: 'github',
          owner: 'deepseek-ai',
          repository: 'dsh-web',
          issueNumber: 1759,
          issueUrl: 'javascript:alert(1)',
          remoteLabels: ['dsh'],
        },
      },
    })

    // When the card-decoration seat renders it
    const container = render(<GitHubCardDecoration task={task} />)

    // Then the badge stays text with the reference as its title
    const badge = container.querySelector('[data-dsh-part="github-badge"]')
    expect(badge?.tagName).toBe('SPAN')
    expect(badge?.getAttribute('href')).toBeNull()
    expect(badge?.getAttribute('title')).toBe('deepseek-ai/dsh-web#1759')
  })

  it('operator sees the extension settings card report the published repositories and credential state', () => {
    // Given a published summary naming one repository and an available credential
    setSummary({
      enabled: true,
      hasCredential: true,
      repositories: [{
        owner: 'deepseek-ai',
        repository: 'dsh',
        inclusionLabel: 'dsh',
        prCreationEnabled: true,
        hasCredential: true,
      }],
    })

    // When the section the board's settings card renders is mounted and the
    // operator opens it
    const container = render(<GitHubSettingsSection {...cardProps()} />)
    expandSettingsCard(container)

    // Then the integration block inside it names itself, the repository,
    // its inclusion label, the auto-PR policy and the credential state
    const text = container.querySelector('[data-dsh-part="github-settings"]')?.textContent ?? ''
    expect(text).toContain(zh['summary.title'])
    expect(text).toContain('deepseek-ai/dsh')
    expect(text).toContain(zh['summary.credentialReady'])
    expect(text).toContain(zh['summary.autoPr'])
  })

  it('operator with the extension switched off sees what turning it on would do, not a dead credential form', () => {
    // Given a section whose master switch draft is off
    // When it renders and the operator opens it
    const container = render(<GitHubSettingsSection {...cardProps('false')} />)
    expandSettingsCard(container)

    // Then the setup block is gone and the explanation stands in its place
    expect(container.querySelector('[data-dsh-part="github-settings"]')).toBeNull()
    expect(container.textContent).toContain(zh['settings.integrationOff'])
    // And the switch itself is still there to turn it back on
    expect(container.textContent).toContain(zh['settings.enabled'])
  })

  it('operator finds the integration card collapsed until they open it', () => {
    // Given the extension section mounted in the board's settings card
    const container = render(<GitHubSettingsSection {...cardProps()} />)

    // When the operator has not opened the card yet
    // Then its header is the only thing rendered, so the board card stays a
    // short list of topics
    const header = container.querySelector('button[aria-expanded]')
    expect(header?.textContent).toContain(zh['settings.title'])
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#settings-task-board-github-enabled')).toBeNull()

    // When the operator opens it
    act(() => { (header as HTMLButtonElement).click() })

    // Then the switches it configures are editable and show the draft they hold
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#settings-task-board-github-enabled')?.textContent).toBe(zh['settings.inherit'])
  })
})
