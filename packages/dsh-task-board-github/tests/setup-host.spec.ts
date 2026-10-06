/**
 * The host setup operations: the one surface the settings card, the host routes
 * and the agent tools all write through.
 *
 * Every case drives the real operation against doubles for the two harness
 * seams it uses (the credential store and the settings document) and for the
 * GitHub API client, so what is asserted is the stored outcome a user would
 * find afterwards, not an internal call order.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GitHubRepoConfig } from '../src/core/types.ts'
import { GitHubApiError, type GitHubApiClient } from '../src/host/client.ts'
import { createGitHubSetup, GitHubSetupError, normalizeTokenInput } from '../src/host/setup.ts'

/** Credential store double: a named map, with the calls it received recorded. */
function credentialStore(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed))
  const calls: string[] = []
  return {
    values,
    calls,
    face: {
      resolve: async (ref: unknown) => {
        const value = values.get(String(ref))
        return value === undefined ? undefined : { value }
      },
      describe: async (ref: unknown) => ({ configured: values.has(String(ref)), writable: true }),
      set: async (ref: unknown, value: string) => {
        calls.push('set ' + String(ref))
        values.set(String(ref), value)
      },
      unset: async (ref: unknown) => {
        calls.push('unset ' + String(ref))
        values.delete(String(ref))
      },
    },
  }
}

/** Settings surface double: one entry, recording every mutation it accepts. */
function settingsSurface(ns: string, value: Record<string, unknown> = { repositories: [] }) {
  const writes: Array<{ ns: string; ops: readonly unknown[]; revision: number | undefined }> = []
  return {
    writes,
    face: {
      writable: true,
      describe: () => [{ ns, revision: 7, value }],
      mutate: async (target: string, ops: readonly unknown[], revision: number | undefined) => {
        writes.push({ ns: target, ops, revision })
      },
    },
  }
}

/** A host context serving exactly the seams a case needs. */
function hostContext(seams: { credentials?: unknown; settings?: unknown; webServer?: unknown }): Context {
  return {
    get: (name: string) => (seams as Record<string, unknown>)[name],
  } as unknown as Context
}

/** One issue row the connection test counts through. */
function issue(number: number, labels: string[], assignees: string[] = []): Record<string, unknown> {
  return {
    number,
    title: 'issue ' + String(number),
    state: 'open',
    html_url: 'https://github.com/x/y/issues/' + String(number),
    labels: labels.map(name => ({ name })),
    assignees: assignees.map(login => ({ login })),
    updated_at: new Date(0).toISOString(),
  }
}

/** One API client double answering the three calls a connection test makes. */
function apiClient(answer: { login?: string; missing?: string[]; throwOnUser?: GitHubApiError; openIssues?: Array<Record<string, unknown>> }) {
  return {
    getAuthenticatedUser: async () => {
      if (answer.throwOnUser !== undefined) throw answer.throwOnUser
      return { login: answer.login ?? 'octocat' }
    },
    getRepository: async (owner: string, repository: string) => {
      if ((answer.missing ?? []).includes(owner + '/' + repository)) {
        throw new GitHubApiError(404, 'GitHub API error (404): Not Found')
      }
      return { full_name: owner + '/' + repository, default_branch: 'main', private: false }
    },
    listOpenIssues: async () => answer.openIssues ?? [],
  } as unknown as GitHubApiClient
}

/** Build one setup surface over the given seams. */
function setupOf(options: {
  repositories?: GitHubRepoConfig[]
  credentials?: ReturnType<typeof credentialStore>
  settings?: ReturnType<typeof settingsSurface>
  client?: GitHubApiClient
  reloads?: { count: number }
}) {
  const credentials = options.credentials ?? credentialStore()
  const settings = options.settings ?? settingsSurface('web-ui-task-board-github')
  const reloads = options.reloads ?? { count: 0 }
  const setup = createGitHubSetup({
    ctx: hostContext({ credentials: credentials.face, settings: settings.face }),
    repositories: () => options.repositories ?? [],
    tokenEnv: () => 'GITHUB_TOKEN',
    running: () => true,
    reload: () => { reloads.count += 1 },
    clientFor: () => options.client ?? apiClient({}),
    env: {},
  })
  return { setup, credentials, settings, reloads }
}

describe('GitHub setup status', () => {
  it('operator opening an unconfigured integration sees what is missing', async () => {
    // Given a deployment with no stored credential and no repository
    const { setup } = setupOf({})

    // When the status is read
    const status = await setup.status()

    // Then the credential reads as unconfigured but writable, and the settings
    // document reports that a write would be accepted
    expect(status.credential).toEqual({ configured: false, writable: true, envName: 'GITHUB_TOKEN' })
    expect(status.repositories).toEqual([])
    expect(status.running).toBe(true)
    expect(status.settingsWritable).toBe(true)
  })

  it('operator with a stored credential sees it configured without ever seeing its value', async () => {
    // Given a credential store holding the reference
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_stored' })
    const { setup } = setupOf({ credentials })

    // When the status is read
    const status = await setup.status()

    // Then the status carries the fact, never the value
    expect(status.credential.configured).toBe(true)
    expect(JSON.stringify(status)).not.toContain('ghp_stored')
  })
})

describe('GitHub credential writes', () => {
  it('operator pasting a token stores it under the configured reference and reloads the provider', async () => {
    // Given an unconfigured integration with an empty store
    const credentials = credentialStore()
    const reloads = { count: 0 }
    const { setup } = setupOf({ credentials, reloads })

    // When a token is stored
    const status = await setup.setCredential('ghp_pasted_token')

    // Then it landed in the store under the reference, the provider reloaded so
    // the next request authenticates, and the status reports it configured
    expect(credentials.values.get('GITHUB_TOKEN')).toBe('ghp_pasted_token')
    expect(credentials.calls).toEqual(['set GITHUB_TOKEN'])
    expect(reloads.count).toBe(1)
    expect(status.credential.configured).toBe(true)
  })

  it('operator clearing the token removes it and reloads the provider', async () => {
    // Given a stored token
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_stored' })
    const reloads = { count: 0 }
    const { setup } = setupOf({ credentials, reloads })

    // When the credential is cleared
    const status = await setup.clearCredential()

    // Then the store no longer holds it and the provider reloaded
    expect(credentials.values.has('GITHUB_TOKEN')).toBe(false)
    expect(credentials.calls).toEqual(['unset GITHUB_TOKEN'])
    expect(reloads.count).toBe(1)
    expect(status.credential.configured).toBe(false)
  })

  it('operator pasting an empty or malformed token is refused before anything is stored', () => {
    // Given the shapes a paste may take
    // When each is validated
    // Then only a plausible token passes
    expect(() => normalizeTokenInput('   ')).toThrow(GitHubSetupError)
    expect(() => normalizeTokenInput('short')).toThrow(GitHubSetupError)
    expect(() => normalizeTokenInput('ghp with space')).toThrow(GitHubSetupError)
    expect(normalizeTokenInput('  ghp_ok_token  ')).toBe('ghp_ok_token')
  })
})

describe('GitHub repository writes', () => {
  it('operator saving a repository list writes it into this extension settings entry', async () => {
    // Given an empty configuration and a writable settings document
    const settings = settingsSurface('web-ui-task-board-github')
    const { setup } = setupOf({ settings })

    // When one repository is written
    const stored = await setup.writeRepositories([{ owner: 'deepseek-ai', repository: 'dsh-web' }])

    // Then the entry received one path write at its own revision
    expect(stored).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
    expect(settings.writes).toEqual([{
      ns: 'web-ui-task-board-github',
      ops: [{ op: 'set', path: ['repositories'], value: [{ owner: 'deepseek-ai', repository: 'dsh-web' }] }],
      revision: 7,
    }])
  })

  it('operator saving the assignee channel keeps it, so assigned issues still reach the board', async () => {
    // Given a writable settings document and a repository configured to also
    // take the issues assigned to this host's own account
    const settings = settingsSurface('web-ui-task-board-github')
    const { setup } = setupOf({ settings })

    // When that list is written through the real write path
    const stored = await setup.writeRepositories([{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }])

    // Then the sanitizer carries the field into the document instead of
    // dropping it, which is what silently emptied the channel in production
    expect(stored).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }])
    expect(settings.writes).toEqual([{
      ns: 'web-ui-task-board-github',
      ops: [{ op: 'set', path: ['repositories'], value: [{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }] }],
      revision: 7,
    }])
  })

  it('operator turning the unassigned channel on survives the write, so the next sync can use it', async () => {
    // Given a writable settings document
    const settings = settingsSurface('web-ui-task-board-github')
    const { setup } = setupOf({ settings })

    // When a repository is written with the unassigned channel on
    const stored = await setup.writeRepositories([{ owner: 'deepseek-ai', repository: 'dsh-web', includeUnassigned: true }])

    // Then the boolean reaches the document rather than being dropped
    expect(stored).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web', includeUnassigned: true }])
  })

  it('operator saving a list that names the same repository twice is refused', async () => {
    // Given a list carrying a duplicate under two spellings
    const settings = settingsSurface('web-ui-task-board-github')
    const { setup } = setupOf({ settings })

    // When it is written
    const write = setup.writeRepositories([{ owner: 'deepseek-ai', repository: 'dsh-web' }, { owner: 'DeepSeek-AI', repository: 'dsh-web' }])

    // Then the write is refused and the document was left untouched
    await expect(write).rejects.toThrow(/listed twice/)
    expect(settings.writes).toEqual([])
  })

  it('operator saving a list with one broken entry is refused', async () => {
    // Given a list whose entry carries no repository name
    const settings = settingsSurface('web-ui-task-board-github')
    const { setup } = setupOf({ settings })

    // When it is written
    const write = setup.writeRepositories([{ owner: 'deepseek-ai' }])

    // Then nothing reached the document
    await expect(write).rejects.toThrow(GitHubSetupError)
    expect(settings.writes).toEqual([])
  })
})

describe('GitHub connection test', () => {
  it('operator testing without a credential learns that GitHub is unauthenticated', async () => {
    // Given no credential anywhere
    const { setup } = setupOf({})

    // When a test runs
    const report = await setup.test()

    // Then it reports no authentication and checks nothing
    expect(report.ok).toBe(false)
    expect(report.login).toBeUndefined()
    expect(report.checks).toEqual([])
  })

  it('operator testing a configured repository sees the account and how many issues the board would take', async () => {
    // Given a stored credential, one configured repository, and three open
    // issues of which two carry the inclusion label
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_stored' })
    const { setup } = setupOf({
      credentials,
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh-web', inclusionLabel: 'board' }],
      client: apiClient({
        login: 'zhu1090093659',
        openIssues: [issue(1, ['board']), issue(2, ['bug']), issue(3, ['board', 'bug'])],
      }),
    })

    // When the test runs
    const report = await setup.test()

    // Then it names the authenticated account and counts through the same
    // inclusion rule the sync uses
    expect(report.ok).toBe(true)
    expect(report.login).toBe('zhu1090093659')
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]).toMatchObject({ owner: 'deepseek-ai', repository: 'dsh-web', ok: true, defaultBranch: 'main', openIssues: 2 })
    expect(report.checks[0]?.message).toContain('label "board"')
  })

  it('operator testing a repository that includes assigned issues counts them without needing the label', async () => {
    // Given a repository whose inclusion comes from assignment as well
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_stored' })
    const { setup } = setupOf({
      credentials,
      repositories: [{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }],
      client: apiClient({
        login: 'zhu1090093659',
        openIssues: [issue(1, ['bug']), issue(2, ['bug'], ['zhu1090093659']), issue(3, ['dsh'])],
      }),
    })

    // When the test runs
    const report = await setup.test()

    // Then the assigned issue and the labelled one are both counted, and the
    // resolved login is reported instead of the `@me` placeholder
    expect(report.checks[0]).toMatchObject({ ok: true, openIssues: 2, assignee: 'zhu1090093659' })
    expect(report.checks[0]?.message).toContain('assignment to zhu1090093659')
  })

  it('operator testing a repository the credential cannot see gets the reason, not a crash', async () => {
    // Given a credential whose account cannot read the repository
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_stored' })
    const { setup } = setupOf({
      credentials,
      repositories: [{ owner: 'deepseek-ai', repository: 'private-thing' }],
      client: apiClient({ missing: ['deepseek-ai/private-thing'] }),
    })

    // When the test runs
    const report = await setup.test()

    // Then the check failed with the status GitHub answered
    expect(report.ok).toBe(false)
    expect(report.checks[0]?.ok).toBe(false)
    expect(report.checks[0]?.message).toContain('404')
  })

  it('operator testing with a rejected token sees that the credential is the problem', async () => {
    // Given a stored credential GitHub refuses
    const credentials = credentialStore({ GITHUB_TOKEN: 'ghp_revoked' })
    const { setup } = setupOf({
      credentials,
      client: apiClient({ throwOnUser: new GitHubApiError(401, 'GitHub API error (401): Bad credentials') }),
    })

    // When the test runs
    const report = await setup.test()

    // Then the report blames the credential
    expect(report.ok).toBe(false)
    expect(report.checks[0]?.message).toContain('401')
  })
})
