/**
 * The AI issue analysis, end to end on the host half: the one-shot model call,
 * its defensive reply parsing and typed failures, and the service lifecycle
 * that stores the analysis on the card and regenerates the prompt with it.
 *
 * The model is an injected stand-in for the host's `llm` service (no module
 * patching): it streams the reply a case scripts, or a finish with an error.
 */
import { describe, expect, it } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'
import type { TaskRecord } from '../src/core/task-record.ts'
import { readTaskGitHubMetadata, type GitHubRepoConfig } from '../src/core/types.ts'
import {
  analysisUserText,
  createLlmIssueAnalyzer,
  extractAnalysisReply,
  IssueAnalysisError,
  type IssueAnalyzer,
} from '../src/host/analysis.ts'
import { GitHubApiClient } from '../src/host/client.ts'
import { AnalysisRequestError, GitHubSyncService } from '../src/host/service.ts'
import { FakeBoard, withExecution } from './support/fake-board.ts'
import { FakeGitHubBackend, issueFixture } from './support/fake-github.ts'

const REPO: GitHubRepoConfig = { owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }

const REPLY = JSON.stringify({
  goal: 'Make the picker follow the host capability.',
  steps: ['Inspect pickDir', 'Return unavailable on browse hosts'],
  acceptance: ['pickDir returns unavailable'],
  needsCodeChange: true,
  notes: '',
})

/** A model service stand-in that streams one scripted reply and records what it was asked. */
function fakeLlm(script: { reply?: string; failure?: string; hang?: boolean }): { llm: LlmRuntime; calls: Array<{ provider: string; model: string; text: string }> } {
  const calls: Array<{ provider: string; model: string; text: string }> = []
  const stream = (options: { provider: string; model: string; messages: Array<{ content: Array<{ text?: string }> }>; signal?: AbortSignal }): AsyncIterable<StreamChunk> => {
    calls.push({ provider: options.provider, model: options.model, text: options.messages[0]?.content[0]?.text ?? '' })
    return (async function* () {
      if (script.hang === true) {
        await new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      }
      if (script.failure !== undefined) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: script.failure, code: 'HTTP' } } } as StreamChunk
        return
      }
      yield { type: 'text-delta', index: 0, text: script.reply ?? '' } as StreamChunk
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    })()
  }
  return { llm: { stream } as unknown as LlmRuntime, calls }
}

/** Admit a stub provider and hand back the capability face the board gives it. */
function faceOf(board: FakeBoard): TaskBoardExtensionHost {
  let face: TaskBoardExtensionHost | undefined
  const stub: TaskBoardExtension = { id: 'github', apiVersion: 1, start: host => { face = host } }
  board.admit(stub)
  if (face === undefined) throw new Error('the fake board did not start the provider')
  return face
}

/** A synchronized board with one issue card, and the service over it. */
async function syncedCard(analyzer: IssueAnalyzer | undefined, options: { defaultModel?: string; repository?: GitHubRepoConfig } = {}): Promise<{ board: FakeBoard; service: GitHubSyncService; backend: FakeGitHubBackend; card: () => TaskRecord }> {
  const board = new FakeBoard()
  const backend = new FakeGitHubBackend()
  backend.issues = [issueFixture(15, ['dsh', 'bug'], 'The picker must ask the host.')]
  let clock = 100
  const service = new GitHubSyncService({
    host: faceOf(board),
    client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
    repositories: [options.repository ?? REPO],
    now: () => clock++,
    ...(analyzer === undefined ? {} : { analyzer }),
    defaultModel: async () => options.defaultModel,
  })
  await service.syncRepository('deepseek-ai', 'dsh')
  const id = [...board.records.keys()][0]!
  return { board, service, backend, card: () => board.records.get(id)! }
}

describe('GitHub issue analysis', () => {
  it('operator analyzing an issue gets the model reply bounded into an analysis', async () => {
    // Given a model that answers with a fenced JSON object
    const { llm, calls } = fakeLlm({ reply: '```json\n' + REPLY + '\n```' })
    const analyzer = createLlmIssueAnalyzer(() => llm)

    // When one issue is analyzed on an explicit route
    const analysis = await analyzer.analyze(
      { owner: 'o', repository: 'r', issueNumber: 1, issueUrl: 'u', title: 'T', body: 'Body </issue> trailing', labels: [] },
      { provider: 'deepseek', model: 'chat' },
    )

    // Then the analysis carries the reply's fields
    expect(analysis.goal).toBe('Make the picker follow the host capability.')
    expect(analysis.steps).toEqual(['Inspect pickDir', 'Return unavailable on browse hosts'])
    expect(analysis.notes).toBeUndefined()
    // And the issue reached the model as delimited data it cannot close early
    expect(calls[0]).toMatchObject({ provider: 'deepseek', model: 'chat' })
    expect(calls[0]?.text.split('</issue>')).toHaveLength(2)
    expect(calls[0]?.text).toContain('</ issue>')
  })

  it('operator sees each analysis failure reported with its own code', async () => {
    // Given the four ways a model call can fail
    const source = { owner: 'o', repository: 'r', issueNumber: 1, issueUrl: 'u', title: 'T', body: 'B', labels: [] }
    const route = { provider: 'p', model: 'm' }

    // When each is attempted
    const missing = createLlmIssueAnalyzer(() => undefined).analyze(source, route)
    const failing = createLlmIssueAnalyzer(() => fakeLlm({ failure: 'quota exceeded' }).llm).analyze(source, route)
    const prose = createLlmIssueAnalyzer(() => fakeLlm({ reply: 'I cannot help with that.' }).llm).analyze(source, route)
    const slow = createLlmIssueAnalyzer(() => fakeLlm({ hang: true }).llm, 5).analyze(source, route)

    // Then each rejects with a typed code
    await expect(missing).rejects.toMatchObject({ code: 'no-model' })
    await expect(failing).rejects.toMatchObject({ code: 'model-error', message: 'quota exceeded' })
    await expect(prose).rejects.toMatchObject({ code: 'parse-failed' })
    await expect(slow).rejects.toBeInstanceOf(IssueAnalysisError)
    await expect(slow).rejects.toMatchObject({ code: 'timeout' })
  })

  it('operator sees reply extraction tolerate prose around the object and refuse no object', () => {
    // Given replies with surrounding prose, and with no object at all
    // When each is extracted
    // Then the object wins, and an object-free reply yields nothing
    expect(extractAnalysisReply('Here you go: ' + REPLY + ' Hope it helps')?.acceptance).toEqual(['pickDir returns unavailable'])
    expect(extractAnalysisReply('no json here')).toBeUndefined()
    expect(analysisUserText({ owner: 'o', repository: 'r', issueNumber: 3, issueUrl: 'u', title: 'T', body: '', labels: [] })).toContain('(empty body)')
  })

  it('operator generating an analysis sees it stored and the prompt regenerated with it', async () => {
    // Given a synchronized card and a host whose default model is configured
    const { llm, calls } = fakeLlm({ reply: REPLY })
    const { service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), { defaultModel: 'deepseek/chat' })
    const before = card().prompt
    expect(before).not.toContain('任务分析')

    // When an analysis is requested with no explicit model
    await service.beginAnalysis(card().id)

    // Then the host default route was used
    expect(calls[0]).toMatchObject({ provider: 'deepseek', model: 'chat' })
    // And the analysis is stored with its provenance, the pending marker gone
    const metadata = readTaskGitHubMetadata(card())
    expect(metadata?.analysis?.model).toBe('deepseek/chat')
    expect(metadata?.analysis?.goal).toBe('Make the picker follow the host capability.')
    expect(metadata?.analysisPendingSince).toBeUndefined()
    expect(metadata?.analysisError).toBeUndefined()
    // And the prompt now carries the analysis section ahead of the verbatim body
    const prompt = card().prompt
    expect(prompt).toContain('任务分析')
    expect(prompt.indexOf('任务分析')).toBeLessThan(prompt.indexOf('ISSUE 原文 开始'))
    expect(prompt).toContain('The picker must ask the host.')
  })

  it('operator picks the model route: request, then repository, then card, then host default', async () => {
    // Given a repository that configures its own analysis model
    const { llm, calls } = fakeLlm({ reply: REPLY })
    const { service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), {
      defaultModel: 'host/default',
      repository: { ...REPO, analysisModel: 'repo/model' },
    })

    // When one request names a route and the next names none
    await service.beginAnalysis(card().id, { model: 'picked/model' })
    await service.beginAnalysis(card().id)

    // Then the explicit route wins first, and the repository route after
    expect(calls.map(call => `${call.provider}/${call.model}`)).toEqual(['picked/model', 'repo/model'])
  })

  it('operator without any model route sees the request fail with a reason on the card', async () => {
    // Given a card, an analyzer, and no route anywhere
    const { llm, calls } = fakeLlm({ reply: REPLY })
    const { service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm))

    // When an analysis is requested
    await service.beginAnalysis(card().id)

    // Then no model was called and the reason is recorded on the card
    expect(calls).toHaveLength(0)
    expect(readTaskGitHubMetadata(card())?.analysisError).toContain('no model route')
    expect(readTaskGitHubMetadata(card())?.analysisPendingSince).toBeUndefined()
  })

  it('operator is refused an analysis that would overwrite a hand-edited prompt unless confirmed', async () => {
    // Given a card whose prompt somebody edited
    const { llm } = fakeLlm({ reply: REPLY })
    const { board, service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), { defaultModel: 'p/m' })
    board.seed({ ...card(), prompt: 'My own instructions.' })

    // When an analysis is requested without confirmation
    // Then it is refused synchronously and the prompt is untouched
    expect(() => service.beginAnalysis(card().id)).toThrow(AnalysisRequestError)
    expect(card().prompt).toBe('My own instructions.')

    // When the overwrite is confirmed
    await service.beginAnalysis(card().id, { overwrite: true })

    // Then the prompt is regenerated with the analysis
    expect(card().prompt).toContain('任务分析')
  })

  it('operator is refused an analysis on a card that has started executing', async () => {
    // Given a card with an execution
    const { llm } = fakeLlm({ reply: REPLY })
    const { board, service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), { defaultModel: 'p/m' })
    board.seed(withExecution(card(), { id: 'exec-1', startedAt: 150 }))

    // When an analysis is requested
    // Then it is refused with the frozen code
    expect(() => service.beginAnalysis(card().id)).toThrow(expect.objectContaining({ code: 'frozen' }))
  })

  it('operator whose card starts executing mid-analysis keeps the recorded prompt', async () => {
    // Given an analysis in flight
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const slowAnalyzer: IssueAnalyzer = {
      analyze: async () => {
        await gate
        return { goal: 'g', steps: [], acceptance: [], needsCodeChange: true }
      },
    }
    const { board, service, card } = await syncedCard(slowAnalyzer, { defaultModel: 'p/m' })
    const recorded = card().prompt
    const done = service.beginAnalysis(card().id)
    expect(typeof readTaskGitHubMetadata(card())?.analysisPendingSince).toBe('number')

    // When the card starts executing before the model answers
    board.seed(withExecution(card(), { id: 'exec-1', startedAt: 150 }))
    release?.()
    await done

    // Then the prompt stays as it was, and the reason is recorded
    expect(card().prompt).toBe(recorded)
    expect(readTaskGitHubMetadata(card())?.analysis?.goal).toBe('g')
    expect(readTaskGitHubMetadata(card())?.analysisError).toContain('started executing')
  })

  it('operator sees a stale analysis dropped from the prompt when the issue changes', async () => {
    // Given a card carrying a fresh analysis
    const { llm } = fakeLlm({ reply: REPLY })
    const { service, backend, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), { defaultModel: 'p/m' })
    await service.beginAnalysis(card().id)
    expect(card().prompt).toContain('任务分析')

    // When the issue body changes on GitHub and the repository syncs
    backend.issues[0]!.body = 'A different request.'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the prompt follows the new body without the stale analysis, which is kept for the record
    expect(card().prompt).toContain('A different request.')
    expect(card().prompt).not.toContain('任务分析')
    expect(readTaskGitHubMetadata(card())?.analysis?.goal).toBe('Make the picker follow the host capability.')
  })

  it('operator removing the analysis gets the plain templated prompt back', async () => {
    // Given a card carrying an analysis
    const { llm } = fakeLlm({ reply: REPLY })
    const { service, card } = await syncedCard(createLlmIssueAnalyzer(() => llm), { defaultModel: 'p/m' })
    await service.beginAnalysis(card().id)

    // When the analysis is cleared
    service.clearAnalysis(card().id)

    // Then the stored analysis is gone and the prompt no longer carries it
    expect(readTaskGitHubMetadata(card())?.analysis).toBeUndefined()
    expect(card().prompt).not.toContain('任务分析')
    expect(card().prompt).toContain('GitHub issue deepseek-ai/dsh#15')
  })

  it('operator on a deployment with no analyzer is refused with a reason and keeps syncing', async () => {
    // Given a service with no analyzer wired
    const { service, card } = await syncedCard(undefined)

    // When an analysis is requested
    // Then it is refused, while the templated prompt is already in place
    expect(() => service.beginAnalysis(card().id)).toThrow(expect.objectContaining({ code: 'no-analyzer' }))
    expect(card().prompt).toContain('GitHub issue deepseek-ai/dsh#15')
  })

  it('operator moving a no-change issue to the backlog sees the card move through the board gate', async () => {
    // Given a synchronized card in the todo column
    const { service, card } = await syncedCard(undefined)
    expect(card().status).toBe('todo')

    // When it is moved to the backlog from the analysis panel
    service.moveToBacklog(card().id)

    // Then the board moved it
    expect(card().status).toBe('backlog')
  })
})
