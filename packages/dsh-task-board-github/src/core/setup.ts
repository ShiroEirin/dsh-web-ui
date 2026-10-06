/**
 * Setup surface shared by both halves: the wire shapes the Host answers its
 * setup routes with, and the parsing and validation every writer of a
 * repository list shares (the settings card, the agent tools, the profile
 * patch).
 *
 * A repository a user adds by hand arrives as text — a full GitHub URL, an
 * SSH remote, or a bare `owner/repo` — while the configuration stores the
 * structured form. Both halves therefore parse through this module rather
 * than each growing its own tolerance, and a value that reaches the
 * configuration is always the sanitized shape with unknown keys dropped.
 *
 * @module dsh-task-board-github/core/setup
 */
import type { GitHubRepoConfig, GitHubStateLabels } from './types.ts'

/**
 * Same-origin route prefix of this extension's setup API, written the way the
 * Host webserver addresses a route: the request pathname always begins at the
 * origin root, so a route registered without the leading slash lands under a
 * key no request can produce and every setup call answers the SPA fallback
 * (404) instead of the route — the card then reports "the Host refused the
 * request (404)" for a deployment that is in fact mounted.
 *
 * The browser half calls the same route document-relative (the GUI is served
 * under `<base href="./">`), which `./client/setup-api.ts` derives from this
 * one constant so the two halves cannot drift apart again.
 */
export const GITHUB_SETUP_API_PREFIX = '/api/task-board-github'

/** Settings namespace this extension's form is served under. */
export const GITHUB_SETTINGS_NAMESPACE = 'task-board-github'

/**
 * Profile entry ids this package's rows carry, most specific first: the
 * aggregate row, the standalone row, then the bare namespace. The Host's
 * settings surface addresses a form by entry id, so both halves resolve their
 * own namespace through this list instead of guessing one.
 */
export const GITHUB_ENTRY_IDS: readonly string[] = ['web-ui-task-board-github', 'ui-task-board-github', GITHUB_SETTINGS_NAMESPACE]

/** Credential facts a configuration surface may render; never the value. */
export interface GitHubCredentialStatus {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active credential provider can write this reference. */
  writable: boolean
  /** Reference the Host resolves, i.e. the configured `tokenEnv`. */
  envName: string
  /** Why the reference cannot be written, when the store refused it. */
  reason?: string
}

/**
 * What a mounted provider reports about its own background synchronization.
 *
 * Declared structurally so the setup surface does not import the service.
 */
export interface GitHubSyncHealth {
  running: boolean
  inFlight: boolean
  lastSyncAt?: number
  lastErrors: string[]
  consecutiveEmptySyncs: number
  staleSince?: number
  staleAfterMs?: number
}

/** Everything the settings card needs to draw the integration at a glance. */
export interface GitHubSetupSummary {
  /** Credential facts, never the token. */
  credential: GitHubCredentialStatus
  /** Repositories the running configuration serves, defaults applied. */
  repositories: GitHubRepoConfig[]
  /** Whether the provider itself is mounted (board and extension both on). */
  running: boolean
  /** Whether the settings document accepts configuration writes at all. */
  settingsWritable: boolean
  /**
   * Whether background synchronization is actually reaching GitHub.
   *
   * Absent when no provider is mounted to report it. It is here because every
   * other field describes CONFIGURATION: a credentialed, enabled, correctly
   * configured integration that has synced nothing for hours looks exactly
   * like a healthy one, and the only way to tell them apart is to show when
   * the last pass landed.
   */
  health?: {
    running: boolean
    inFlight: boolean
    /** When the last pass reached GitHub without an error, ms epoch. */
    lastSyncAt?: number
    /** What the last pass reported, empty when it was clean. */
    lastErrors: string[]
    /** Passes in a row that produced neither a sync nor a clean result. */
    consecutiveEmptySyncs: number
    /** Set once the last clean pass is older than three poll intervals. */
    staleSince?: number
    staleAfterMs?: number
  }
}

/** One repository's outcome in a connection test. */
export interface GitHubRepositoryCheck {
  /** Repository owner. */
  owner: string
  /** Repository name. */
  repository: string
  /** Whether the repository answered. */
  ok: boolean
  /** Human-readable outcome: what answered, or why it did not. */
  message: string
  /** Repository default branch, when it answered. */
  defaultBranch?: string
  /** Whether the repository is private to the authenticated account. */
  private?: boolean
  /** Open issues the board would take (inclusion label, assignment, or no assignee), when they could be counted. */
  openIssues?: number
  /** Assignee login the check matched on, when the repository configures one. */
  assignee?: string
  /** Whether the repository also takes issues that carry no assignee. */
  includeUnassigned?: boolean
}

/** Outcome of one live connection test. */
export interface GitHubConnectionReport {
  /** Whether the credential authenticated and every checked repository answered. */
  ok: boolean
  /** Login of the authenticated account, when the credential authenticated at all. */
  login?: string
  /** Credential facts at the time of the test. */
  credential: GitHubCredentialStatus
  /** One entry per checked repository. */
  checks: GitHubRepositoryCheck[]
}

/** Owner and name of one repository, as parsed from user input. */
export interface ParsedRepository {
  /** Repository owner (user or organization). */
  owner: string
  /** Repository name. */
  repository: string
}

/** Owner and repository names GitHub itself accepts. */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/

/**
 * Parse the repository text a user or a model typed.
 *
 * Accepts a full HTTPS URL (deep links such as an issue URL keep their first
 * two path segments), an SSH remote in scp syntax, and the bare
 * `owner/repo` form with an optional `.git` suffix.
 * @param input - the raw text.
 * @returns the parsed owner and name, or undefined when the text names no repository.
 */
export function parseRepositoryInput(input: string): ParsedRepository | undefined {
  let text = input.trim()
  if (text === '') return undefined
  text = text.replace(/^git\+/, '')

  let path: string
  const url = /^(?:https?:\/\/)?(?:[^/@\s]+@)?(?:[^/:\s]+)(?::\d+)?\/(.+)$/.exec(text)
  const scp = /^(?:[^/@\s]+@)?[^/:\s]+:(.+)$/.exec(text)
  if (text.includes('://') || text.startsWith('//')) {
    // A web URL: the repository is the first two segments of its path.
    const rest = text.replace(/^[a-z+]+:\/\//i, '')
    const slash = rest.indexOf('/')
    if (slash < 0) return undefined
    path = rest.slice(slash + 1)
    const parts = path.split('/').filter(part => part !== '')
    if (parts.length < 2) return undefined
    return check(parts[0]!, parts[1]!)
  }
  if (scp !== null) {
    // An scp-style remote (git@host:owner/repo.git).
    path = scp[1]!
    const parts = path.split('/').filter(part => part !== '')
    if (parts.length < 2) return undefined
    return check(parts[0]!, parts[1]!)
  }
  if (url !== null && /^[^/\s]+\.[^/\s]+\//.test(text) && !text.startsWith('github.com/')) {
    // A scheme-less host path such as github.com/owner/repo.
    const parts = url[1]!.split('/').filter(part => part !== '')
    if (parts.length < 2) return undefined
    return check(parts[0]!, parts[1]!)
  }
  const parts = text.split('/').filter(part => part !== '')
  if (parts.length !== 2) return undefined
  return check(parts[0]!, parts[1]!)
}

/** Validate one parsed pair against GitHub's own name grammar. */
function check(owner: string, repository: string): ParsedRepository | undefined {
  const name = repository.replace(/\.git$/i, '')
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return undefined
  if (name === '.' || name === '..') return undefined
  return { owner, repository: name }
}

/** Owner-and-name label of one repository. */
export function repositorySlug(repository: { owner: string; repository: string }): string {
  return `${repository.owner}/${repository.repository}`
}

/**
 * Sanitize one repository configuration arriving from a wire or a hand-edited
 * document: required fields decide whether the entry is this shape at all,
 * every optional field is copied only when it carries the right type, and
 * unknown keys are dropped.
 * @param value - candidate entry.
 * @returns the sanitized configuration, or undefined when it is not one.
 */
export function sanitizeRepositoryConfig(value: unknown): GitHubRepoConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const owner = typeof raw.owner === 'string' ? raw.owner.trim() : ''
  const repository = typeof raw.repository === 'string' ? raw.repository.trim() : ''
  if (!SEGMENT.test(owner) || !SEGMENT.test(repository)) return undefined
  const config: GitHubRepoConfig = { owner, repository }
  const inclusionLabel = text(raw.inclusionLabel)
  if (inclusionLabel !== undefined) config.inclusionLabel = inclusionLabel
  // An empty string is meaningful here: it is how the assignee channel is
  // switched off, so it survives the sanitizer instead of being dropped as
  // "no value". The inclusion rule reads the field, not its absence.
  const assignee = text(raw.assignee)
  if (raw.assignee !== undefined) config.assignee = assignee ?? ''
  const managedLabelPrefix = text(raw.managedLabelPrefix)
  if (managedLabelPrefix !== undefined) config.managedLabelPrefix = managedLabelPrefix
  const prPhaseLabel = text(raw.prPhaseLabel)
  if (prPhaseLabel !== undefined) config.prPhaseLabel = prPhaseLabel
  const baseBranch = text(raw.baseBranch)
  if (baseBranch !== undefined) config.baseBranch = baseBranch
  const analysisModel = text(raw.analysisModel)
  if (analysisModel !== undefined) config.analysisModel = analysisModel
  if (typeof raw.pollingIntervalMs === 'number' && Number.isFinite(raw.pollingIntervalMs) && raw.pollingIntervalMs >= 0) {
    config.pollingIntervalMs = Math.floor(raw.pollingIntervalMs)
  }
  if (typeof raw.includeUnassigned === 'boolean') config.includeUnassigned = raw.includeUnassigned
  if (typeof raw.prCreationEnabled === 'boolean') config.prCreationEnabled = raw.prCreationEnabled
  if (typeof raw.closeIssueOnMerge === 'boolean') config.closeIssueOnMerge = raw.closeIssueOnMerge
  if (raw.draftPrPolicy === 'draft' || raw.draftPrPolicy === 'ready') config.draftPrPolicy = raw.draftPrPolicy
  const stateLabels = sanitizeStateLabels(raw.stateLabels)
  if (stateLabels !== undefined) config.stateLabels = stateLabels
  return config
}

/**
 * Sanitize a whole repository list. The list is all-or-nothing: one entry that
 * is not this shape refuses the write rather than silently dropping it.
 * @param value - candidate list.
 * @returns the sanitized list, or undefined when any entry is invalid.
 */
export function sanitizeRepositoryList(value: unknown): GitHubRepoConfig[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list: GitHubRepoConfig[] = []
  for (const entry of value) {
    const config = sanitizeRepositoryConfig(entry)
    if (config === undefined) return undefined
    list.push(config)
  }
  return list
}

/** Copy a non-empty trimmed string, or undefined. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Copy the known status-label overrides out of an unknown value. */
function sanitizeStateLabels(value: unknown): GitHubStateLabels | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const labels: GitHubStateLabels = {}
  for (const key of ['backlog', 'todo', 'running', 'done', 'failed'] as const) {
    const label = text(raw[key])
    if (label !== undefined) labels[key] = label
  }
  return Object.keys(labels).length > 0 ? labels : undefined
}

/** Optional per-repository fields an edit may set. */
export interface RepositoryOptions {
  /** Issue label that opts an issue into the board. */
  inclusionLabel?: string
  /**
   * Login whose assigned issues are included too — `@me` for this host's own
   * account. An empty string clears the channel.
   */
  assignee?: string
  /**
   * Whether issues with no assignee at all are included too; false is the
   * default and only a boolean may set it.
   */
  includeUnassigned?: boolean
  /** Base branch pull requests target. */
  baseBranch?: string
  /** Whether the extension may open pull requests. */
  prCreationEnabled?: boolean
  /** Background polling interval in milliseconds. */
  pollingIntervalMs?: number
  /**
   * Qualified provider/model the issue analysis uses. An empty string clears
   * it, so the analysis falls back to the card's model and then the host default.
   */
  analysisModel?: string
}

/** Outcome of one list edit: the new list, or why the edit was refused. */
export type RepositoryEditResult =
  | { ok: true; repositories: GitHubRepoConfig[] }
  | { ok: false; code: string; message: string }

/** Case-insensitive identity of one repository inside a list. */
function identityOf(repository: { owner: string; repository: string }): string {
  return repository.owner.toLowerCase() + '/' + repository.repository.toLowerCase()
}

/** Copy the supplied options onto one repository configuration. */
function withOptions(base: GitHubRepoConfig, options: RepositoryOptions): GitHubRepoConfig {
  const next: GitHubRepoConfig = { ...base }
  if (options.inclusionLabel !== undefined && options.inclusionLabel.trim() !== '') next.inclusionLabel = options.inclusionLabel.trim()
  if (options.assignee !== undefined) {
    // An explicit empty string turns the channel off, which is how a card row
    // clears an assignee without dropping the repository.
    const assignee = options.assignee.trim()
    if (assignee === '') delete next.assignee
    else next.assignee = assignee
  }
  if (options.includeUnassigned !== undefined) next.includeUnassigned = options.includeUnassigned
  if (options.baseBranch !== undefined && options.baseBranch.trim() !== '') next.baseBranch = options.baseBranch.trim()
  if (options.prCreationEnabled !== undefined) next.prCreationEnabled = options.prCreationEnabled
  if (options.pollingIntervalMs !== undefined && Number.isFinite(options.pollingIntervalMs) && options.pollingIntervalMs >= 0) {
    next.pollingIntervalMs = Math.floor(options.pollingIntervalMs)
  }
  if (options.analysisModel !== undefined) {
    const analysisModel = options.analysisModel.trim()
    if (analysisModel === '') delete next.analysisModel
    else next.analysisModel = analysisModel
  }
  return next
}

/**
 * Add one repository, typed as `owner/repo`, a GitHub URL, or an SSH remote.
 * @param list - the current list.
 * @param input - the repository text.
 * @param options - optional fields to set on the new entry.
 * @returns the new list, or the reason the entry was refused.
 */
export function addRepository(list: readonly GitHubRepoConfig[], input: string, options: RepositoryOptions = {}): RepositoryEditResult {
  const parsed = parseRepositoryInput(input)
  if (parsed === undefined) {
    return { ok: false, code: 'repository-invalid', message: '"' + input.trim() + '" is not a GitHub repository; use owner/repo or paste its URL' }
  }
  const key = identityOf(parsed)
  if (list.some(entry => identityOf(entry) === key)) {
    return { ok: false, code: 'repository-duplicate', message: repositorySlug(parsed) + ' is already configured' }
  }
  return { ok: true, repositories: [...list.map(entry => ({ ...entry })), withOptions({ ...parsed }, options)] }
}

/**
 * Remove one repository.
 * @param list - the current list.
 * @param input - the repository text.
 * @returns the new list, or the reason nothing was removed.
 */
export function removeRepository(list: readonly GitHubRepoConfig[], input: string): RepositoryEditResult {
  const parsed = parseRepositoryInput(input)
  if (parsed === undefined) {
    return { ok: false, code: 'repository-invalid', message: '"' + input.trim() + '" is not a GitHub repository' }
  }
  const key = identityOf(parsed)
  if (!list.some(entry => identityOf(entry) === key)) {
    return { ok: false, code: 'repository-absent', message: repositorySlug(parsed) + ' is not configured' }
  }
  return { ok: true, repositories: list.filter(entry => identityOf(entry) !== key).map(entry => ({ ...entry })) }
}

/**
 * Change optional fields of one configured repository.
 * @param list - the current list.
 * @param input - the repository text.
 * @param options - the fields to change.
 * @returns the new list, or the reason nothing changed.
 */
export function updateRepository(list: readonly GitHubRepoConfig[], input: string, options: RepositoryOptions): RepositoryEditResult {
  const parsed = parseRepositoryInput(input)
  if (parsed === undefined) {
    return { ok: false, code: 'repository-invalid', message: '"' + input.trim() + '" is not a GitHub repository' }
  }
  if (Object.keys(options).length === 0) {
    return { ok: false, code: 'nothing-to-update', message: 'name at least one field to change' }
  }
  const key = identityOf(parsed)
  if (!list.some(entry => identityOf(entry) === key)) {
    return { ok: false, code: 'repository-absent', message: repositorySlug(parsed) + ' is not configured' }
  }
  return {
    ok: true,
    repositories: list.map(entry => identityOf(entry) === key ? withOptions(entry, options) : { ...entry }),
  }
}
