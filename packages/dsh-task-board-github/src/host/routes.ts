/**
 * Host routes of this extension's setup API.
 *
 * The settings card and the setup tools both write configuration through the
 * shared setup surface; the card reaches it over these same-origin routes, and
 * they are the only HTTP surface this extension opens. Every route answers
 * loopback requests only (the desktop and the local browser the GUI is served
 * to) — a paired LAN browser has no business reading or writing a GitHub token
 * — and no route ever echoes a credential value back.
 *
 * @module dsh-task-board-github/host/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { GITHUB_SETUP_API_PREFIX } from '../core/setup.ts'
import { isLoopbackRequest } from '../loopback.ts'
import { asJsonObject, readJsonBody, writeJson } from './http.ts'
import { GitHubSetupError, type GitHubSetup } from './setup.ts'

/** Body cap of the credential route: one token, with room to spare. */
const CREDENTIAL_BODY_MAX_BYTES = 4 * 1024

/** Body cap of the repository route: hundreds of repositories still fit. */
const REPOSITORY_BODY_MAX_BYTES = 64 * 1024

/**
 * Build the setup routes.
 * @param setup - the shared setup surface.
 * @returns the routes, for `ctx.webServer.register`.
 */
export function makeGitHubSetupRoutes(setup: GitHubSetup): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: GITHUB_SETUP_API_PREFIX + '/status',
      handler: (req, res) => route(req, res, async () => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        writeJson(res, 200, { ok: true, ...(await setup.status()) }, { 'cache-control': 'no-store' })
      }),
    },
    {
      kind: 'exact',
      path: GITHUB_SETUP_API_PREFIX + '/test',
      handler: (req, res) => route(req, res, async () => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const body = asJsonObject(await readJsonBody(req, { maxBytes: CREDENTIAL_BODY_MAX_BYTES })) ?? {}
        const owner = typeof body.owner === 'string' ? body.owner : undefined
        const repository = typeof body.repository === 'string' ? body.repository : undefined
        const report = await setup.test(owner === undefined || repository === undefined ? {} : { owner, repository })
        writeJson(res, 200, { ok: true, report }, { 'cache-control': 'no-store' })
      }),
    },
    {
      kind: 'exact',
      path: GITHUB_SETUP_API_PREFIX + '/credential',
      handler: (req, res) => route(req, res, async () => {
        if (req.method === 'DELETE') {
          writeJson(res, 200, { ok: true, ...(await setup.clearCredential()) }, { 'cache-control': 'no-store' })
          return
        }
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const body = asJsonObject(await readJsonBody(req, { maxBytes: CREDENTIAL_BODY_MAX_BYTES }))
        const token = typeof body?.token === 'string' ? body.token : undefined
        if (token === undefined) return writeJson(res, 400, { ok: false, error: 'a token is required' })
        writeJson(res, 200, { ok: true, ...(await setup.setCredential(token)) }, { 'cache-control': 'no-store' })
      }),
    },
    {
      kind: 'exact',
      path: GITHUB_SETUP_API_PREFIX + '/repositories',
      handler: (req, res) => route(req, res, async () => {
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, repositories: setup.listRepositories() }, { 'cache-control': 'no-store' })
          return
        }
        if (req.method !== 'PUT') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const body = asJsonObject(await readJsonBody(req, { maxBytes: REPOSITORY_BODY_MAX_BYTES }))
        const list = body?.repositories
        if (!Array.isArray(list)) {
          return writeJson(res, 400, { ok: false, error: 'a repositories array is required' })
        }
        const repositories = await setup.writeRepositories(list)
        writeJson(res, 200, { ok: true, repositories }, { 'cache-control': 'no-store' })
      }),
    },
  ]
}

/**
 * One route body: the loopback fence, then the handler, with failures mapped
 * onto a status the card can explain.
 */
async function route(req: IncomingMessage, res: ServerResponse, handler: () => Promise<void>): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return
  }
  try {
    await handler()
  } catch (error) {
    if (error instanceof GitHubSetupError) {
      writeJson(res, error.status, { ok: false, error: error.message, code: error.code })
      return
    }
    writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
