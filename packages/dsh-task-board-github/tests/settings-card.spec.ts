/**
 * The GitHub provider settings card: the master switch it renders and the write
 * its save produces. This stage's card is the switch plus the stage notice.
 */
import { describe, expect, it } from 'vitest'
import { GithubSettingsCardController } from '../src/client/GithubSettingsCard.tsx'
import type { GitHubSetupApi } from '../src/client/setup-api.ts'

/**
 * The setup API the card's integration block talks to. These cases are about
 * the staged switches, so the block's own surface stays inert: nothing here is
 * reached while a switch is edited and saved.
 */
const idleSetupApi: GitHubSetupApi = {
  status: async () => ({ credential: { configured: false, writable: false, envName: 'GITHUB_TOKEN' }, repositories: [], running: false, settingsWritable: false }),
  test: async () => ({ ok: false, credential: { configured: false, writable: false, envName: 'GITHUB_TOKEN' }, checks: [] }),
  setCredential: async () => ({ credential: { configured: true, writable: true, envName: 'GITHUB_TOKEN' }, repositories: [], running: false, settingsWritable: true }),
  clearCredential: async () => ({ credential: { configured: false, writable: true, envName: 'GITHUB_TOKEN' }, repositories: [], running: false, settingsWritable: true }),
  listRepositories: async () => [],
  writeRepositories: async repositories => [...repositories],
}

/**
 * Settings-form double that applies the batched writes the card submits, so
 * the staged form's read-back judgment settles on the same values the Host
 * would hold.
 */
function form(initial: Record<string, unknown>) {
  const user: Record<string, unknown> = { ...initial }
  const ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }> = []
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { ...user },
      base: undefined,
      user: { ...user },
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async (batch: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
      ops.push(...batch)
      for (const op of batch) {
        if (op.op === 'set') user[op.path[0]!] = op.value
        else delete user[op.path[0]!]
      }
      return true
    },
  }
  return { scope, ops }
}

describe('GitHub provider settings card', () => {
  it('operator turning the switch off stages the boolean the Host schema expects', async () => {
    // Given a card bound to a form whose switch is on
    const { scope, ops } = form({ enabled: true })
    const controller = new GithubSettingsCardController(scope as never, idleSetupApi)
    const face = controller.inject()

    // When the operator turns it off and saves
    face.edit('enabled', 'false')
    await (face.save() as unknown as Promise<void>)

    // Then the Host receives one boolean write for the enabled field
    expect(ops).toEqual([{ op: 'set', path: ['enabled'], value: false }])
    expect(face.hooks.githubSettingsCard.getSnapshot().enabled).toEqual({ text: 'false', overridden: true, invalid: false })
    controller.dispose()
  })

  it('operator turning the announcement on stages the boolean the Host schema expects', async () => {
    // Given a card bound to a form whose announcement switch is off
    const { scope, ops } = form({ enabled: true })
    const controller = new GithubSettingsCardController(scope as never, idleSetupApi)
    const face = controller.inject()

    // When the operator turns the announcement on and saves
    face.edit('announceToAgent', 'true')
    await (face.save() as unknown as Promise<void>)

    // Then the Host receives one boolean write for the announcement field,
    // which is the switch the system-prompt section follows
    expect(ops).toEqual([{ op: 'set', path: ['announceToAgent'], value: true }])
    expect(face.hooks.githubSettingsCard.getSnapshot().announceToAgent).toEqual({ text: 'true', overridden: true, invalid: false })
    controller.dispose()
  })

  it('operator saving without touching the switch writes nothing', async () => {
    // Given a card whose switch already matches the stored value
    const { scope, ops } = form({ enabled: true })
    const controller = new GithubSettingsCardController(scope as never, idleSetupApi)
    const face = controller.inject()

    // When the operator saves without editing anything
    await (face.save() as unknown as Promise<void>)

    // Then the namespace is left untouched
    expect(ops).toEqual([])
    controller.dispose()
  })

  it('operator clearing an override lets the deployment default apply again', async () => {
    // Given a card whose switch the user layer overrides
    const { scope, ops } = form({ enabled: false })
    const controller = new GithubSettingsCardController(scope as never, idleSetupApi)
    const face = controller.inject()

    // When the operator resets the field and saves
    face.resetField('enabled')
    await (face.save() as unknown as Promise<void>)

    // Then the user-layer entry is dropped instead of writing a value
    expect(ops).toEqual([{ op: 'unset', path: ['enabled'] }])
    controller.dispose()
  })
})
