/**
 * Route-surface tests for the self-update host half: the loopback fence, the
 * method gates, and the JSON response contract. makeUpdateRoutes takes its
 * check/run seams injected, so the route behavior is exercised over real HTTP
 * without a registry, a pnpm process, or a profile on disk.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { UpdateRunResult, UpdateStatus } from '../src/update.ts'
import { isLoopbackRequest } from '../src/loopback.ts'
import { makeUpdateRoutes, UPDATE_PATHS } from '../src/update-routes.ts'

const STATUS: UpdateStatus = {
  mode: 'npm',
  profileName: 'web',
  anchor: '@linxin666/dsh-web-all',
  packages: [{ name: '@linxin666/dsh-web-all', current: '0.4.1', latest: '0.4.2', outdated: true }],
  outdated: true,
}

const RUN: UpdateRunResult = { ok: true, exitCode: 0, output: 'updated @linxin666/dsh-web-all' }

let server: Server
let port: number
let checks = 0
let runs = 0

beforeAll(async () => {
  const routes: WebRoute[] = makeUpdateRoutes({
    fence: isLoopbackRequest,
    check: async () => {
      checks += 1
      return STATUS
    },
    run: async () => {
      runs += 1
      return RUN
    },
  })
  server = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** One real request against the mounted route family (body decoded per content type). */
function httpCall(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request_ = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const json = (res.headers['content-type'] ?? '').includes('application/json')
        resolve({ status: res.statusCode ?? 0, body: text === '' ? undefined : json ? JSON.parse(text) : text })
      })
    })
    request_.on('error', reject)
    request_.end()
  })
}

describe('self-update routes', () => {
  it('operator: a loopback GET on the status route answers the probe result', async () => {
    // Given the update routes mounted on a loopback web server
    checks = 0
    // When the local GUI asks for the update status
    const response = await httpCall('GET', UPDATE_PATHS.status)
    // Then the probe result is served as JSON and the seam ran once
    expect(response.status).toBe(200)
    expect(response.body).toEqual(STATUS)
    expect(checks).toBe(1)
  })

  it('operator: a loopback POST on the run route answers the install outcome', async () => {
    // Given the update routes mounted on a loopback web server
    runs = 0
    // When the user confirms the update from the panel
    const response = await httpCall('POST', UPDATE_PATHS.run)
    // Then the run result is served as JSON and the seam ran once
    expect(response.status).toBe(200)
    expect(response.body).toEqual(RUN)
    expect(runs).toBe(1)
  })

  it('operator: a non-POST on the run route is refused without starting an install', async () => {
    // Given the update routes mounted on a loopback web server
    runs = 0
    // When a GET reaches the install endpoint
    const response = await httpCall('GET', UPDATE_PATHS.run)
    // Then the method is refused and no install was started
    expect(response.status).toBe(405)
    expect(runs).toBe(0)
  })

  it('operator: a non-GET on the status route is refused without probing', async () => {
    // Given the update routes mounted on a loopback web server
    checks = 0
    // When a POST reaches the status endpoint
    const response = await httpCall('POST', UPDATE_PATHS.status)
    // Then the method is refused and no probe ran
    expect(response.status).toBe(405)
    expect(checks).toBe(0)
  })

  it('operator: a LAN origin is refused the install endpoint', async () => {
    // Given a request whose Host header names a LAN address instead of loopback
    runs = 0
    // When it reaches the run route from a non-loopback authority
    const response = await httpCall('POST', UPDATE_PATHS.run, { host: '192.168.1.5:3080' })
    // Then the fence answers 403 and the host process starts no install
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, code: 'forbidden' })
    expect(runs).toBe(0)
  })

  it('operator: a cross-site browser request is refused the status route', async () => {
    // Given a loopback Host header carrying a cross-site fetch marker
    checks = 0
    // When the browser labels the request cross-site
    const response = await httpCall('GET', UPDATE_PATHS.status, { 'sec-fetch-site': 'cross-site' })
    // Then the fence answers 403 and no registry probe runs
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, code: 'forbidden' })
    expect(checks).toBe(0)
  })
})
