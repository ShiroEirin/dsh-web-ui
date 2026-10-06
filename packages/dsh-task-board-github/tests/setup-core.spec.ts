/**
 * The shared setup surface both halves write through: repository text parsing,
 * the pure list edits the settings card and the agent tools run, and the
 * sanitizer every configuration write passes through.
 */
import { describe, expect, it } from 'vitest'
import {
  addRepository,
  parseRepositoryInput,
  removeRepository,
  repositorySlug,
  sanitizeRepositoryConfig,
  sanitizeRepositoryList,
  updateRepository,
} from '../src/core/setup.ts'

describe('GitHub repository input parsing', () => {
  it('operator typing a bare pair, a URL, an SSH remote or a deep link gets the same repository', () => {
    // Given the shapes a person or a model may paste
    const inputs = [
      'deepseek-ai/dsh-web',
      '  deepseek-ai/dsh-web  ',
      'https://github.com/deepseek-ai/dsh-web',
      'https://github.com/deepseek-ai/dsh-web/issues/1758',
      'git@github.com:deepseek-ai/dsh-web.git',
      'deepseek-ai/dsh-web.git',
    ]

    // When each is parsed
    const parsed = inputs.map(input => parseRepositoryInput(input))

    // Then every one names the same owner and repository
    expect(parsed).toEqual(inputs.map(() => ({ owner: 'deepseek-ai', repository: 'dsh-web' })))
  })

  it('operator pasting something that names no repository is refused instead of guessed at', () => {
    // Given text that is not a repository
    const inputs = ['', '   ', 'deepseek-ai', 'a/b/c', 'https://github.com/deepseek-ai']

    // When each is parsed
    // Then none of them resolves to a repository
    expect(inputs.map(input => parseRepositoryInput(input))).toEqual(inputs.map(() => undefined))
  })
})

describe('GitHub repository list edits', () => {
  it('operator can switch the assignee channel on when adding and back off when updating', () => {
    // Given an empty list
    // When a repository is added with the assignee channel
    const added = addRepository([], 'deepseek-ai/dsh-web', { assignee: '@me' })

    // Then the entry carries it
    expect(added).toEqual({ ok: true, repositories: [{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }] })
    if (!added.ok) throw new Error('the add was refused')

    // When the channel is cleared with an explicit empty string
    const cleared = updateRepository(added.repositories, 'deepseek-ai/dsh-web', { assignee: '' })

    // Then the field is gone rather than stored empty, so the repository keeps
    // its label channel and nothing else
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.repositories[0]).toEqual({ owner: 'deepseek-ai', repository: 'dsh-web' })
  })

  it('operator adding a repository gets the sanitized entry appended', () => {
    // Given an empty list
    // When one repository is added with an inclusion label
    const edit = addRepository([], 'https://github.com/deepseek-ai/dsh-web', { inclusionLabel: 'board' })

    // Then the entry carries the parsed identity and the supplied option
    expect(edit).toEqual({ ok: true, repositories: [{ owner: 'deepseek-ai', repository: 'dsh-web', inclusionLabel: 'board' }] })
  })

  it('operator adding a repository twice is refused by identity, not by spelling', () => {
    // Given a list that already carries the repository
    const list = [{ owner: 'DeepSeek-AI', repository: 'dsh-web' }]

    // When the same repository is added through a different spelling
    const edit = addRepository(list, 'https://github.com/deepseek-ai/dsh-web')

    // Then the duplicate is refused with the identity it collided on
    expect(edit.ok).toBe(false)
    if (!edit.ok) expect(edit.message).toContain('deepseek-ai/dsh-web')
  })

  it('operator removing a configured repository drops exactly that entry', () => {
    // Given two configured repositories
    const list = [{ owner: 'deepseek-ai', repository: 'dsh-web' }, { owner: 'other', repository: 'thing' }]

    // When one is removed
    const edit = removeRepository(list, 'other/thing')

    // Then only the other one is left
    expect(edit).toEqual({ ok: true, repositories: [{ owner: 'deepseek-ai', repository: 'dsh-web' }] })
  })

  it('operator updating a repository changes only the named fields', () => {
    // Given a configured repository with an inclusion label
    const list = [{ owner: 'deepseek-ai', repository: 'dsh-web', inclusionLabel: 'dsh', baseBranch: 'dev' }]

    // When its inclusion label is changed
    const edit = updateRepository(list, 'deepseek-ai/dsh-web', { inclusionLabel: 'board' })

    // Then the label changed and the untouched branch survived
    expect(edit.ok).toBe(true)
    if (edit.ok) {
      expect(edit.repositories[0]).toEqual({ owner: 'deepseek-ai', repository: 'dsh-web', inclusionLabel: 'board', baseBranch: 'dev' })
    }
  })

  it('operator updating a repository that is not configured is refused with a reason', () => {
    // Given an empty list
    // When an update names a repository
    const edit = updateRepository([], 'deepseek-ai/dsh-web', { inclusionLabel: 'dsh' })

    // Then the edit is refused for the missing entry
    expect(edit.ok).toBe(false)
    if (!edit.ok) expect(edit.code).toBe('repository-absent')
  })
})

describe('GitHub repository configuration sanitizing', () => {
  it('operator hand-editing the document keeps known fields and loses unknown ones', () => {
    // Given an entry carrying a known override and a stray key
    const sanitized = sanitizeRepositoryConfig({
      owner: ' deepseek-ai ',
      repository: 'dsh-web',
      inclusionLabel: ' board ',
      prCreationEnabled: true,
      pollingIntervalMs: 1000.7,
      somethingElse: 'drop me',
    })

    // When it is sanitized
    // Then the known fields are trimmed and coerced and the stray key is gone
    expect(sanitized).toEqual({
      owner: 'deepseek-ai',
      repository: 'dsh-web',
      inclusionLabel: 'board',
      prCreationEnabled: true,
      pollingIntervalMs: 1000,
    })
  })

  it('operator writing a list with one broken entry gets the whole write refused', () => {
    // Given a list whose second entry names no repository
    const sanitized = sanitizeRepositoryList([{ owner: 'deepseek-ai', repository: 'dsh-web' }, { owner: 'deepseek-ai' }])

    // When it is sanitized
    // Then nothing is written, so a typo cannot silently drop a repository
    expect(sanitized).toBeUndefined()
  })

  it('operator reading a configured entry back gets a stable slug', () => {
    // Given a parsed repository
    // When its slug is read
    // Then it is the owner-and-name label every surface prints
    expect(repositorySlug({ owner: 'deepseek-ai', repository: 'dsh-web' })).toBe('deepseek-ai/dsh-web')
  })
})
