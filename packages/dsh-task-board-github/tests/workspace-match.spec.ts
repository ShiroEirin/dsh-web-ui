/**
 * The repository-to-workspace inference, exercised as a pure rule.
 *
 * The interesting cases are the misses: this rule may only ever leave a card
 * on the board's existing inheritance behavior, never move one somewhere new.
 */
import { describe, expect, it } from 'vitest'
import { comparableName, directoryName, workspaceIdForRepository } from '../src/core/workspace-match.ts'

describe('repository workspace inference', () => {
  it('operator reading a checkout path gets its directory name on either separator', () => {
    // Given: POSIX, Windows and trailing-separator paths
    const paths = ['/home/dev/code/dsh', 'C:\\Users\\dev\\code\\dsh', '/home/dev/code/dsh/']

    // When: each is reduced to its last segment
    const names = paths.map(directoryName)

    // Then: the directory name comes back, and a root with no segment does not
    expect(names).toEqual(['dsh', 'dsh', 'dsh'])
    expect(directoryName('C:\\')).toBe('C:')
    expect(directoryName('   ')).toBe('')
  })

  it('operator comparing repository names finds case and punctuation equivalent', () => {
    // Given: the spellings one project turns up under
    const spellings = ['DSH-Web', 'dsh_web', 'dsh.web', '  dsh--web  ']

    // When: each is normalized
    const comparable = spellings.map(comparableName)

    // Then: all four are the same name, so a checkout named either matches
    expect(comparable).toEqual(['dsh-web', 'dsh-web', 'dsh-web', 'dsh-web'])
  })

  it('operator whose checkout is named after the repository gets it pinned', () => {
    // Given: a deployment holding the matching checkout and one that is not
    const workspaces = [
      { id: 'ws-web', path: '/home/dev/code/dsh-web' },
      { id: 'ws-other', path: '/home/dev/code/harness' },
    ]

    // When: an issue from that repository is placed
    const pinned = workspaceIdForRepository('dsh-web', workspaces)

    // Then: the matching checkout is chosen, not merely the first one listed
    expect(pinned).toBe('ws-web')
  })

  it('operator with a Windows checkout gets the same match', () => {
    // Given: a Windows path for the same repository
    const workspaces = [{ id: 'ws-web', path: 'C:\\Users\\dev\\code\\dsh-web' }]

    // When: the issue is placed
    const pinned = workspaceIdForRepository('dsh-web', workspaces)

    // Then: the separator style changes nothing
    expect(pinned).toBe('ws-web')
  })

  it('operator whose workspace records only a name still gets a match', () => {
    // Given: a workspace with a display name and no path
    const workspaces = [{ id: 'ws-web', name: 'dsh-web' }]

    // When: the issue is placed
    const pinned = workspaceIdForRepository('dsh-web', workspaces)

    // Then: the name is consulted when the path is absent
    expect(pinned).toBe('ws-web')
  })

  it('operator whose old checkout shares a prefix gets no pin at all', () => {
    // Given: a differently-named project whose directory merely starts the same
    const workspaces = [{ id: 'ws-old', path: '/home/dev/code/dsh-web-old' }]

    // When: the dsh-web issue is placed
    const pinned = workspaceIdForRepository('dsh-web', workspaces)

    // Then: nothing is pinned; a lookalike is not a match
    expect(pinned).toBeUndefined()
  })

  it('operator whose repository name is a prefix of the checkout gets no pin', () => {
    // Given: a monorepo whose directory merely contains the repository name
    const workspaces = [{ id: 'ws-web', path: '/home/dev/code/dsh-web' }]

    // When: a differently-named repository sharing that prefix is placed
    const pinned = workspaceIdForRepository('dsh', workspaces)

    // Then: a substring is not a match
    expect(pinned).toBeUndefined()
  })

  it('operator with two checkouts of one project is asked to choose instead of a pin being picked', () => {
    // Given: the same project checked out twice
    const workspaces = [
      { id: 'ws-personal', path: '/home/dev/personal/dsh' },
      { id: 'ws-work', path: '/home/dev/work/dsh' },
    ]

    // When: the issue is placed
    const pinned = workspaceIdForRepository('dsh', workspaces)

    // Then: the ambiguity is a miss, not a coin flip between two real projects
    expect(pinned).toBeUndefined()
  })

  it('operator whose workspace matches on both its path and its name gets one pin, not two', () => {
    // Given: a workspace whose path and display name both match
    const workspaces = [{ id: 'ws-web', path: '/home/dev/code/dsh-web', name: 'dsh-web' }]

    // When: the issue is placed
    const pinned = workspaceIdForRepository('dsh-web', workspaces)

    // Then: it counts once, so it is a match rather than a false ambiguity
    expect(pinned).toBe('ws-web')
  })

  it('operator with nothing to match against gets no pin', () => {
    // Given: an empty registry, a blank repository name and a blank path
    const candidates: Array<{ id: string, path?: string, name?: string }> = []

    // When: each is offered as the whole input
    const outcomes = [
      workspaceIdForRepository('dsh-web', candidates),
      workspaceIdForRepository('   ', [{ id: 'ws-web', path: '/x/dsh-web' }]),
      workspaceIdForRepository('dsh-web', [{ id: 'ws-web', path: '   ' }]),
    ]

    // Then: every case misses and the card keeps the board's own rules
    expect(outcomes).toEqual([undefined, undefined, undefined])
  })
})
