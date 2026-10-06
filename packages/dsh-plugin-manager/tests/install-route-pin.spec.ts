import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes, type RegistryVersionManifest } from '../src/host/routes.ts'
import { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

/**
 * An unversioned install spec must be pinned to the registry's current latest
 * before it reaches the installer. pnpm 11 silently skips releases younger
 * than `minimumReleaseAge` (24 h by default), so a bare name resolves one
 * release behind with no error (#1759).
 *
 * test-standards-allow: route unit tests over a synthetic profile and registry
 */

function profileFacts(): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-install-route-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return {
    facts: { profileName: 'web', profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), packageJsonPath: join(profileDir, 'package.json') },
    dir,
  }
}

function request(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
  return stream
}

function response(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let code = 200
  let text = ''
  return {
    res: { writeHead(value: number) { code = value }, end(value: string) { text = value } } as unknown as ServerResponse,
    status: () => code,
    body: () => JSON.parse(text),
  }
}

const tempDirs: string[] = []
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function installHandler(fetchManifest: (name: string) => Promise<RegistryVersionManifest | undefined>, install = vi.fn(() => ({ jobId: 'job-1' }))) {
  const { facts, dir } = profileFacts()
  tempDirs.push(dir)
  const gateway = { install, withMutationLock: async <T>(task: () => Promise<T>) => await task() } as unknown as CliGateway
  const handler = makeGatewayRoutes({ facts, gateway, cliAvailable: () => true, fetchManifest })
    .find(route => route.path === '/api/plugin-manager/install')!.handler
  return { handler, install }
}

describe('gateway install route', () => {
  it('operator installing an unversioned package name gets the registry latest pinned (#1759)', async () => {
    // Given the registry's latest for the aggregate, which pnpm's release-age
    // gate would otherwise skip when the spec carries no version
    const { handler, install } = installHandler(async () => ({ version: '0.4.4' }))
    const captured = response()

    // When the operator installs a bare scoped package name
    await handler(request({ spec: '@linxin666/dsh-web-all' }), captured.res)

    // Then the installer receives the exact version, not the bare name
    expect(captured.status()).toBe(200)
    expect(install).toHaveBeenCalledWith('@linxin666/dsh-web-all@0.4.4')
  })

  it('operator installing an unversioned unscoped package name gets the registry latest', async () => {
    // Given an unscoped package whose registry latest is 2.1.0
    const { handler, install } = installHandler(async () => ({ version: '2.1.0' }))
    const captured = response()

    // When the operator installs the bare name
    await handler(request({ spec: 'dsh-memoir' }), captured.res)

    // Then the scoped-name path is not the only one that pins
    expect(install).toHaveBeenCalledWith('dsh-memoir@2.1.0')
  })

  it('operator installing an exact version keeps the version they chose', async () => {
    // Given a spec that already names a version, which is never second-guessed
    const { handler, install } = installHandler(async () => ({ version: '9.9.9' }))
    const captured = response()

    // When the operator installs that exact version
    await handler(request({ spec: '@linxin666/dsh-web-all@0.4.3' }), captured.res)

    // Then it is forwarded verbatim, not replaced by the registry latest
    expect(install).toHaveBeenCalledWith('@linxin666/dsh-web-all@0.4.3')
  })

  it.each(['dsh-memoir@next', 'dsh-memoir@^1.0.0', 'dsh-memoir@1.x'])(
  'operator installing the range or dist-tag %s keeps it', async (spec) => {
    // Given a spec whose trailing segment is a range or tag, not a bare name
    const { handler, install } = installHandler(async () => ({ version: '9.9.9' }))
    const captured = response()

    // When the operator installs it
    await handler(request({ spec }), captured.res)

    // Then the caller's intent survives untouched
    expect(install).toHaveBeenCalledWith(spec)
  })

  it('operator installing a local path is not given a registry version', async () => {
    // Given a file: spec, which is not a registry selector at all
    const { handler, install } = installHandler(async () => ({ version: '9.9.9' }))
    const captured = response()

    // When the operator installs it
    await handler(request({ spec: 'file:../local-plugin' }), captured.res)

    // Then there is no version to resolve and the spec is forwarded as given
    expect(install).toHaveBeenCalledWith('file:../local-plugin')
  })

  it('operator installing while the registry is unreachable still starts the install', async () => {
    // Given a registry probe that cannot answer
    const { handler, install } = installHandler(async () => undefined)
    const captured = response()

    // When the operator installs a bare name
    await handler(request({ spec: '@linxin666/dsh-web-all' }), captured.res)

    // Then the outage does not block the install outright; the bare spec runs
    expect(captured.status()).toBe(200)
    expect(install).toHaveBeenCalledWith('@linxin666/dsh-web-all')
  })
})