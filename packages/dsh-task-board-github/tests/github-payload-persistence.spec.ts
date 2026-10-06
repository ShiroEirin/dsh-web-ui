/**
 * The provider payload rides the board's opaque integrations container, so it
 * must survive a persistence round-trip without a schema migration and without
 * disturbing a card that carries none. These cases serialize the board's cards
 * the way the Host writes its ledger and read them back the way the provider
 * does at startup.
 */
import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../src/core/task-record.ts'
import { readTaskGitHubMetadata } from '../src/core/types.ts'
import { FakeBoard, plainTask } from './support/fake-board.ts'

/** The GitHub metadata a synchronized card carries. */
const INTEGRATION = {
  github: {
    provider: 'github' as const,
    owner: 'deepseek-ai',
    repository: 'dsh',
    issueNumber: 1758,
    issueUrl: 'https://github.com/deepseek-ai/dsh/issues/1758',
    remoteLabels: ['dsh', 'enhancement'],
    remoteState: 'open' as const,
    pullRequest: {
      number: 42,
      url: 'https://github.com/deepseek-ai/dsh/pull/42',
      state: 'open' as const,
      draft: true,
      headBranch: 'feat/gh',
      baseBranch: 'main',
    },
  },
}

/** Serialize records and read them back through a fresh board, as a restart does. */
function rehydrate(records: Iterable<TaskRecord>): FakeBoard {
  const board = new FakeBoard()
  const parsed = JSON.parse(JSON.stringify([...records])) as TaskRecord[]
  for (const task of parsed) board.seed(task)
  return board
}

describe('GitHub payload persistence', () => {
  it('operator restarting the Host keeps the provider metadata on a synchronized card', () => {
    // Given a card carrying GitHub provider metadata
    const board = new FakeBoard()
    board.seed({ ...plainTask('task-gh', { title: 'Sync me' }), integrations: INTEGRATION })

    // When the persisted cards are re-read the way the Host does at startup
    const restored = rehydrate(board.records.values()).records.get('task-gh')

    // Then the card comes back with its stable identity, labels and PR intact
    const metadata = readTaskGitHubMetadata(restored)
    expect(metadata?.issueNumber).toBe(1758)
    expect(metadata?.remoteLabels).toEqual(['dsh', 'enhancement'])
    expect(metadata?.pullRequest?.number).toBe(42)
    expect(metadata?.pullRequest?.draft).toBe(true)
    expect(metadata?.pullRequest?.headBranch).toBe('feat/gh')
  })

  it('operator keeps a plain local card unchanged across the round trip', () => {
    // Given a card with no integrations at all
    const board = new FakeBoard()
    board.seed(plainTask('task-plain', { title: 'Plain' }))

    // When the cards are serialized and re-read
    const restored = rehydrate(board.records.values()).records.get('task-plain')

    // Then the card carries no integrations, so no migration is required for
    // existing ledgers and the provider claims nothing it does not own
    expect(restored?.title).toBe('Plain')
    expect(restored?.integrations).toBeUndefined()
    expect(readTaskGitHubMetadata(restored)).toBeUndefined()
  })

  it('operator sees a malformed stored payload dropped instead of the whole card', () => {
    // Given a persisted card whose integrations container repaired to nothing
    const board = new FakeBoard()
    board.seed({ ...plainTask('task-gh', { title: 'Sync me' }), integrations: {} })

    // When the card is re-read
    const restored = rehydrate(board.records.values()).records.get('task-gh')

    // Then the card survives with the unusable container read as absent, rather
    // than the provider crashing on another package's leftovers
    expect(restored?.title).toBe('Sync me')
    expect(readTaskGitHubMetadata(restored)).toBeUndefined()
  })
})
