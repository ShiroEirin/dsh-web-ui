/**
 * Host-side GitHub credential resolution over the harness credential seam.
 *
 * The token is never returned to the browser and never stored in this
 * extension's own configuration: it lives either in the harness credential
 * store (the same store the Models page writes API keys into) or in the
 * process environment. This module is the single place both halves' writers
 * (the setup routes and the agent tools) and the sync client read it from.
 *
 * Resolution order is the credential store first — a value the user stored
 * through the settings card or an agent must win over an ambient variable —
 * then the configured environment variable, then `GH_TOKEN`, which the GitHub
 * CLI and this extension's own client have always accepted.
 *
 * @module dsh-task-board-github/host/credentials
 */
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type { GitHubCredentialStatus } from '../core/setup.ts'

/** Credential facts one reference reports; no slot carries a value. */
interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

/** The slice of the credential seam this extension uses. */
export interface CredentialFace {
  resolve(ref: unknown): Promise<{ value: string; source?: string } | undefined>
  describe(ref: unknown): Promise<CredentialInfo>
  set(ref: unknown, value: string): Promise<void>
  unset(ref: unknown): Promise<void>
}

/**
 * Resolve the optional credential service without declaring a required
 * injection: a deployment that serves none keeps working on the environment
 * alone.
 * @param ctx - host context.
 * @returns the seam, or undefined.
 */
export function resolveCredentialFace(ctx: Context): CredentialFace | undefined {
  try {
    const get = (ctx as { get?: (name: string) => unknown }).get
    if (typeof get !== 'function') return undefined
    const face = get.call(ctx, 'credentials') as CredentialFace | undefined
    if (face === undefined) return undefined
    const usable = typeof face.resolve === 'function'
      && typeof face.describe === 'function'
      && typeof face.set === 'function'
      && typeof face.unset === 'function'
    return usable ? face : undefined
  } catch {
    return undefined
  }
}

/**
 * Report one reference's credential facts for a configuration surface.
 * @param ctx - host context.
 * @param envName - the configured reference name.
 * @param env - environment to consult for the ambient fallback.
 * @returns the status a card or a tool may render.
 */
export async function describeGitHubCredential(
  ctx: Context,
  envName: string,
  env: Record<string, string | undefined> = process.env,
): Promise<GitHubCredentialStatus> {
  const face = resolveCredentialFace(ctx)
  let info: CredentialInfo | undefined
  if (face !== undefined && isCredentialRefName(envName)) {
    try {
      info = await face.describe(credentialRef(envName))
    } catch {
      info = undefined
    }
  }
  const ambient = ambientToken(env, envName)
  if (info !== undefined && info.configured) {
    return { configured: true, writable: info.writable, envName, ...(info.source === undefined ? {} : { source: info.source }) }
  }
  if (ambient !== undefined) {
    return {
      configured: true,
      writable: info?.writable ?? false,
      envName,
      source: 'environment',
      ...(info !== undefined && !info.writable ? { reason: 'the environment shadows this reference' } : {}),
    }
  }
  return { configured: false, writable: info?.writable ?? face !== undefined, envName, ...(face === undefined ? { reason: 'this deployment serves no credential store' } : {}) }
}

/**
 * Resolve the effective token for one reference.
 * @param ctx - host context.
 * @param envName - the configured reference name.
 * @param env - environment to consult for the ambient fallback.
 * @returns the token, or undefined when none is configured.
 */
export async function resolveGitHubToken(
  ctx: Context,
  envName: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const face = resolveCredentialFace(ctx)
  if (face !== undefined && isCredentialRefName(envName)) {
    try {
      const resolved = await face.resolve(credentialRef(envName))
      if (resolved?.value !== undefined && resolved.value.trim() !== '') return resolved.value.trim()
    } catch {
      // An unreadable store falls through to the environment.
    }
  }
  return ambientToken(env, envName)
}

/**
 * Store one token in the credential seam.
 * @param ctx - host context.
 * @param envName - the reference to write.
 * @param token - the secret value.
 * @throws when no credential store is served, the reference is outside the
 *   grammar, or the store refuses the write (a read-only source shadows it).
 */
export async function setGitHubToken(ctx: Context, envName: string, token: string): Promise<void> {
  const face = resolveCredentialFace(ctx)
  if (face === undefined) throw new Error('this deployment serves no credential store; set the token through the environment instead')
  if (!isCredentialRefName(envName)) throw new Error(`"${envName}" is not a valid credential reference name`)
  await face.set(credentialRef(envName), token)
}

/**
 * Remove one stored token. Absent values are a no-op, matching the seam.
 * @param ctx - host context.
 * @param envName - the reference to clear.
 * @throws when no credential store is served.
 */
export async function clearGitHubToken(ctx: Context, envName: string): Promise<void> {
  const face = resolveCredentialFace(ctx)
  if (face === undefined) throw new Error('this deployment serves no credential store')
  if (!isCredentialRefName(envName)) throw new Error(`"${envName}" is not a valid credential reference name`)
  await face.unset(credentialRef(envName))
}

/** The ambient fallback: the configured variable, then GH_TOKEN. */
function ambientToken(env: Record<string, string | undefined>, envName: string): string | undefined {
  for (const name of [envName, 'GH_TOKEN']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}
