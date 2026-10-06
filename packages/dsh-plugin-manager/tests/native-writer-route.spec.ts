/**
 * Route-level writer gate: the CLI-availability guard must never reject a job
 * the official in-process manager is going to run (an application-owned
 * profile), while an ordinary profile — or an application-owned one whose host
 * mounts no manager — keeps the 500.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CliGateway } from '../src/host/gateway.ts'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function loopbackPost(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
  return stream
}

function captureResponse(): { res: ServerResponse; body: () => string; status: () => number } {
  let status = 200
  let text = ''
  const res = {
    writeHead(code: number) { status = code },
    end(chunk: string) { text = chunk },
  } as unknown as ServerResponse
  return { res, body: () => text, status: () => status }
}

/** A temp profile carrying the named dependencies as plain packages. */
function makeProfile(deps: string[], desktop: boolean): ProfileFacts {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-route-'))
  tempDirs.push(dir)
  const profileDir = join(dir, 'profiles', desktop ? 'desktop' : 'web')
  mkdirSync(profileDir, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const name of deps) {
    dependencies[name] = '1.0.0'
    const moduleDir = join(profileDir, 'node_modules', ...name.split('/'))
    mkdirSync(moduleDir, { recursive: true })
    writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-route', private: true, dependencies, dsh: { profile: { bundles: deps } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return {
    profileName: desktop ? 'desktop' : 'web',
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
    ...desktop ? { desktop: true } : {},
  }
}

interface GateOptions {
  cli: boolean
  native: boolean
  fetchManifest?: (name: string) => Promise<{ version: string } | undefined>
}

/** One route handler over a profile with a scripted CLI presence and manager. */
function handlerFor(facts: ProfileFacts, path: string, options: GateOptions) {
  const gateway = new CliGateway(facts, {} as NodeJS.ProcessEnv, {
    findBinary: () => options.cli ? '/fake/dsh' : null,
    nativeManager: () => options.native
      ? { installBundle: async () => {}, removeBundle: async () => {} }
      : undefined,
  })
  return makeGatewayRoutes({
    facts,
    gateway,
    cliAvailable: () => options.cli,
    ...options.fetchManifest === undefined ? {} : { fetchManifest: options.fetchManifest },
  }).find(route => route.path === path)!.handler
}

describe('route writer gate on an application-owned profile', () => {
  it('operator: gets an install job from the official manager when no CLI exists', async () => {
    // Given a desktop profile whose host mounts the official manager and no CLI
    const facts = makeProfile([], true)
    const handler = handlerFor(facts, '/api/plugin-manager/install', { cli: false, native: true })

    // When the install request arrives
    const { res, body, status } = captureResponse()
    await handler(loopbackPost({ spec: 'dsh-free-search' }), res)

    // Then the job is created instead of being refused for the missing CLI
    expect(status()).toBe(200)
    expect(JSON.parse(body()).jobId).toMatch(/^job-\d+$/)
  })

  it('operator: gets a removal job from the official manager when no CLI exists', async () => {
    // Given the same host shape with the package installed
    const facts = makeProfile(['dsh-free-search'], true)
    const handler = handlerFor(facts, '/api/plugin-manager/remove', { cli: false, native: true })

    // When the removal request arrives
    const { res, body, status } = captureResponse()
    await handler(loopbackPost({ id: 'dsh-free-search' }), res)

    // Then the job is created
    expect(status()).toBe(200)
    expect(JSON.parse(body()).jobId).toMatch(/^job-\d+$/)
  })

  it('operator: gets an update job from the official manager when no CLI exists', async () => {
    // Given an installed package with a newer version in the registry
    const facts = makeProfile(['dsh-memoir'], true)
    const handler = handlerFor(facts, '/api/plugin-manager/update', {
      cli: false,
      native: true,
      fetchManifest: async () => ({ version: '1.1.0' }),
    })

    // When the update request arrives
    const { res, body, status } = captureResponse()
    await handler(loopbackPost({ id: 'dsh-memoir' }), res)

    // Then the job is created
    expect(status()).toBe(200)
    expect(JSON.parse(body()).jobId).toMatch(/^job-\d+$/)
  })
})

describe('route writer gate without the official manager', () => {
  it('operator: keeps the CLI-missing 500 on an ordinary profile', async () => {
    // Given an ordinary profile whose host has no CLI and no application-owned writer
    const facts = makeProfile([], false)
    const handler = handlerFor(facts, '/api/plugin-manager/install', { cli: false, native: true })

    // When the install request arrives
    const { res, body, status } = captureResponse()
    await handler(loopbackPost({ spec: 'dsh-free-search' }), res)

    // Then it is refused for the missing CLI, exactly as before
    expect(status()).toBe(500)
    expect(JSON.parse(body()).error).toContain('dsh CLI not found on PATH')
  })

  it('operator: keeps the CLI-missing 500 when the desktop host mounts no manager', async () => {
    // Given a desktop profile whose host publishes no official manager
    const facts = makeProfile([], true)
    const handler = handlerFor(facts, '/api/plugin-manager/install', { cli: false, native: false })

    // When the install request arrives
    const { res, body, status } = captureResponse()
    await handler(loopbackPost({ spec: 'dsh-free-search' }), res)

    // Then the gateway fails closed on the writer it actually has
    expect(status()).toBe(500)
    expect(JSON.parse(body()).error).toContain('dsh CLI not found on PATH')
  })
})
