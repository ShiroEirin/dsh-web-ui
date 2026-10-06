/**
 * Outbound HTTPS client for the GitHub REST API (v2022-11-28).
 *
 * Security:
 * - Runs exclusively in the Host process.
 * - Outbound-only HTTPS to api.github.com.
 * - Credentials resolved from Host environment / profile patch; never sent to browser or agent.
 *
 * @module dsh-task-board-github/host/client
 */

import type { GitHubCommentPayload, GitHubIssuePayload, GitHubPullRequestPayload } from '../core/types.ts'

/**
 * Default ceiling on one GitHub request, in milliseconds.
 *
 * Generous enough for a slow connection and small enough that a wedged one
 * is bounded: a pass makes many sequential requests, so an unbounded request
 * does not cost one call, it costs the entire pass and every poll after it.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly endpoint?: string,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

/**
 * A request that exceeded its ceiling.
 *
 * Distinct from a transport error so a caller can tell "GitHub said no" from
 * "GitHub never answered", which are different problems with different fixes.
 */
export class GitHubTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly endpoint: string,
  ) {
    super(`GitHub request timed out after ${String(timeoutMs)}ms: ${endpoint}`)
    this.name = 'GitHubTimeoutError'
  }
}

export interface GitHubClientOptions {
  /** Explicit API token (testing or direct programmatic injection). */
  token?: string
  /** Environment variable name holding the token (default: 'GITHUB_TOKEN'). */
  tokenEnv?: string
  /** Custom base URL (default: 'https://api.github.com'). */
  baseUrl?: string
  /** Injected fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof fetch
  /** Custom env dictionary (defaults to process.env). */
  env?: Record<string, string | undefined>
  /**
   * Ceiling on one request, in milliseconds.
   *
   * Every request is bounded by this. A sync pass issues a hundred or more
   * single-issue reads for the cards a listing did not return, and an
   * unbounded fetch on any of them can leave the await pending forever —
   * which wedges the whole background poll, silently, on every start. Zero or
   * less disables the bound and restores the old (unsafe) behavior.
   */
  requestTimeoutMs?: number
}

export class GitHubApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenEnv: string
  private readonly explicitToken?: string
  private readonly env: Record<string, string | undefined>
  private readonly requestTimeoutMs: number
  /** Token supplied by the owner per pass; wins over the configured value. */
  private liveToken: string | undefined

  constructor(options: GitHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.tokenEnv = options.tokenEnv ?? 'GITHUB_TOKEN'
    this.explicitToken = options.token
    this.env = options.env ?? process.env
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  /**
   * Replace the token this client authenticates with.
   *
   * The credential store is ASYNC, so a client cannot read it inside the
   * synchronous request path. It is resolved by the owner once per pass and
   * handed in here, which is what lets a client that was built before the
   * store came up authenticate on the next pass instead of never.
   * @param token - the live token, or undefined to fall back to the configured
   * value and the environment.
   */
  setToken(token: string | undefined): void {
    this.liveToken = token !== undefined && token.trim() !== '' ? token.trim() : undefined
  }

  /** Resolve effective GitHub token. Returns undefined when none is configured. */
  getToken(): string | undefined {
    if (this.liveToken !== undefined) return this.liveToken
    if (this.explicitToken !== undefined && this.explicitToken.trim() !== '') {
      return this.explicitToken.trim()
    }
    const token = this.env[this.tokenEnv] ?? this.env.GH_TOKEN
    return token !== undefined && token.trim() !== '' ? token.trim() : undefined
  }

  /** Whether a valid authentication credential is present on the Host. */
  hasCredential(): boolean {
    return this.getToken() !== undefined
  }

  /**
   * One request, guaranteed to settle.
   *
   * The ceiling is enforced with a real AbortSignal rather than a raced
   * promise: a race would let the caller continue while the socket stayed
   * open, and this client is shared by every poll. A fetch that ignores the
   * signal is still bounded by the race, so both guards are present — the
   * signal releases the socket, the race guarantees the await returns.
   */
  private async boundedFetch(input: string, init: RequestInit): Promise<Response> {
    const bound = this.requestTimeoutMs
    if (!(bound > 0)) return await this.fetchImpl(input, init)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, bound)
    try {
      return await Promise.race([
        this.fetchImpl(input, { ...init, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => { reject(new GitHubTimeoutError(bound, input)) }, bound)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
      body?: unknown
      headers?: Record<string, string>
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
    const token = this.getToken()
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-task-board',
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    }
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    const response = await this.boundedFetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })

    if (!response.ok) {
      let errorDetail = response.statusText
      try {
        const data = await response.json() as { message?: string }
        if (typeof data?.message === 'string' && data.message !== '') {
          errorDetail = data.message
        }
      } catch {
        // use statusText
      }
      throw new GitHubApiError(response.status, `GitHub API error (${response.status}): ${errorDetail}`, endpoint)
    }

    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  /**
   * List issues in a repository.
   * Excludes pull requests (GitHub REST /issues returns both by default).
   */
  async listIssues(owner: string, repo: string, labels?: string[]): Promise<GitHubIssuePayload[]> {
    const params = new URLSearchParams({ state: 'all', per_page: '100' })
    if (labels !== undefined && labels.length > 0) {
      params.set('labels', labels.join(','))
    }
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params.toString()}`
    const raw = await this.request<GitHubIssuePayload[]>(endpoint)
    // Filter out pull requests
    return raw.filter(item => item.pull_request === undefined)
  }

  /** Get one specific issue by number. */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssuePayload> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`
    return await this.request<GitHubIssuePayload>(endpoint)
  }

  /** Update issue properties (state or title/body). */
  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    patch: { state?: 'open' | 'closed'; title?: string; body?: string },
  ): Promise<GitHubIssuePayload> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`
    return await this.request<GitHubIssuePayload>(endpoint, { method: 'PATCH', body: patch })
  }

  /**
   * Post one comment on an issue (or a PR: the REST endpoint is shared).
   *
   * The body is sent verbatim. The caller is responsible for what it puts
   * there; the extension only bounds the length it will transmit.
   */
  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubCommentPayload> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`
    return await this.request<GitHubCommentPayload>(endpoint, { method: 'POST', body: { body } })
  }

  /** Replace all labels on an issue. */
  async setIssueLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/labels`
    await this.request(endpoint, { method: 'PUT', body: { labels } })
  }

  /** Add labels to an issue without removing existing ones. */
  async addIssueLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/labels`
    await this.request(endpoint, { method: 'POST', body: { labels } })
  }

  /** Remove one specific label from an issue. Tolerates 404 (already absent). */
  async removeIssueLabel(owner: string, repo: string, issueNumber: number, labelName: string): Promise<void> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/labels/${encodeURIComponent(labelName)}`
    try {
      await this.request(endpoint, { method: 'DELETE' })
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return
      throw error
    }
  }

  /** Check if a branch exists remotely on the repository. */
  async getBranch(owner: string, repo: string, branch: string): Promise<{ name: string; commit: { sha: string } } | null> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
    try {
      return await this.request<{ name: string; commit: { sha: string } }>(endpoint)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null
      throw error
    }
  }

  /** Create a new pull request. */
  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; head: string; base: string; body?: string; draft?: boolean },
  ): Promise<GitHubPullRequestPayload> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`
    return await this.request<GitHubPullRequestPayload>(endpoint, { method: 'POST', body: input })
  }

  /** Get pull request details by number. */
  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequestPayload> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`
    return await this.request<GitHubPullRequestPayload>(endpoint)
  }

  /**
   * Identify the account this credential authenticates as. The setup surface
   * uses it as the one call that proves a token works before it checks any
   * repository.
   */
  async getAuthenticatedUser(): Promise<{ login: string; name?: string | null }> {
    return await this.request<{ login: string; name?: string | null }>('/user')
  }

  /** Read one repository's identity facts, or throw the status that refused it. */
  async getRepository(owner: string, repo: string): Promise<{ full_name?: string; default_branch?: string; private?: boolean }> {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    return await this.request<{ full_name?: string; default_branch?: string; private?: boolean }>(endpoint)
  }

  /**
   * List one repository's open issues, pull requests filtered out.
   *
   * The connection test counts through this listing with the same inclusion
   * rule the sync uses, so the number it reports is what the board would take,
   * not what a label query alone would return.
   */
  async listOpenIssues(owner: string, repo: string, cap = 100): Promise<GitHubIssuePayload[]> {
    const params = new URLSearchParams({ state: 'open', per_page: String(cap) })
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params.toString()}`
    const raw = await this.request<GitHubIssuePayload[]>(endpoint)
    return raw.filter(item => item.pull_request === undefined)
  }
}
