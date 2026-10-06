/**
 * The GitHub fields of this extension's own Config schema.
 *
 * Every field is volatile — that marker is what puts a field on the Host's
 * settings page and lets the settings card, the setup tools and the profile
 * patch write it — so these cases read values the way the plugin does, through
 * {@link resolveProviderSettings}, and pin the defaults a patch inherits plus
 * the fact that the nested repository object validates one entry at a time.
 */
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_TOKEN_ENV, resolveProviderSettings } from '../src/index.ts'

describe('GitHub extension repository configuration schema', () => {
  it('operator configuring no GitHub repository gets an empty list and the default token variable', () => {
    // Given a profile patch that configures no GitHub integration at all
    const resolved = resolveProviderSettings(Config({}))

    // When the repository fields are read
    // Then the integration is inert and looks for the conventional variable,
    // so an unconfigured deployment behaves exactly as before the feature
    expect(resolved.repositories).toEqual([])
    expect(resolved.tokenEnv).toBe(DEFAULT_TOKEN_ENV)
  })

  it('operator declaring only owner and repository gets every per-repository default filled in', () => {
    // Given a minimal repository entry
    const resolved = resolveProviderSettings(Config({ repositories: [{ owner: 'deepseek-ai', repository: 'dsh' }] }))

    // When the resolved entry is read
    // Then the inclusion label, managed prefix, state labels, PR policy and
    // auto-PR switch all carry their documented defaults
    const repositories = resolved.repositories
    expect(repositories).toHaveLength(1)
    expect(repositories[0]).toMatchObject({
      owner: 'deepseek-ai',
      repository: 'dsh',
      inclusionLabel: 'dsh',
      managedLabelPrefix: 'dsh:',
      prPhaseLabel: 'dsh:phase:pr',
      prCreationEnabled: false,
      draftPrPolicy: 'draft',
      closeIssueOnMerge: true,
      baseBranch: 'main',
    })
    expect(repositories[0]?.stateLabels).toEqual({
      backlog: 'dsh:state:backlog',
      todo: 'dsh:state:todo',
      running: 'dsh:state:running',
      done: 'dsh:state:done',
      failed: 'dsh:state:failed',
    })
  })

  it('operator keeping several repositories configured gets each one resolved independently', () => {
    // Given two repositories with different inclusion labels
    const resolved = resolveProviderSettings(Config({
      repositories: [
        { owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' },
        { owner: 'other-org', repository: 'other-repo', inclusionLabel: 'board', prCreationEnabled: true },
      ],
    }))

    // When the resolved list is read
    // Then both survive with their own labels and PR policy
    const repositories = resolved.repositories
    expect(repositories).toHaveLength(2)
    expect(repositories[0]?.inclusionLabel).toBe('dsh')
    expect(repositories[0]?.prCreationEnabled).toBe(false)
    expect(repositories[1]?.inclusionLabel).toBe('board')
    expect(repositories[1]?.prCreationEnabled).toBe(true)
  })
})
