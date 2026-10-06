/**
 * In-process GitHub REST stand-in covering exactly the endpoints the provider
 * calls: issue listing and lookup, label add/remove, branch lookup, PR creation
 * and lookup, and issue state patching. The provider's HTTP surface is its out
 * boundary, so replacing it is what keeps these cases free of a live network
 * without replacing the provider itself.
 *
 * @module tests/support/fake-github
 */
import type { GitHubIssuePayload, GitHubPullRequestPayload } from '../../src/core/types.ts'

/** A JSON response with the GitHub content type. */
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** The label names carried by an issue payload. */
export function nameOf(labels: GitHubIssuePayload['labels']): string[] {
  return labels.map(label => (typeof label === 'string' ? label : label.name))
}

/** One open issue fixture carrying the given labels, body and assignees. */
export function issueFixture(number: number, labels: string[], body = '', assignees: string[] = []): GitHubIssuePayload {
  return {
    number,
    title: `Issue ${String(number)}`,
    body,
    state: 'open',
    html_url: `https://github.com/deepseek-ai/dsh/issues/${String(number)}`,
    labels,
    assignees: assignees.map(login => ({ login })),
    updated_at: '2026-09-02T10:00:00Z',
  }
}

/** One in-process GitHub remote. */
export class FakeGitHubBackend {
  issues: GitHubIssuePayload[] = []
  pulls: GitHubPullRequestPayload[] = []
  branches: string[] = []
  /** Login the stand-in answers `GET /user` with. */
  login = 'tester'
  networkFailure = false
  /** How many HTTP calls reached the stand-in. */
  requests = 0
  /** Comment bodies posted through the stand-in, in arrival order. */
  comments: Array<{ issueNumber: number, body: string }> = []

  fetch: typeof fetch = async (input, init) => {
    this.requests += 1
    if (this.networkFailure) throw new Error('Network error: ETIMEDOUT')
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    const method = init?.method ?? 'GET'
    const pathname = url.pathname

    if (pathname === '/user' && method === 'GET') {
      return json({ login: this.login })
    }
    if (pathname.includes('/issues') && method === 'GET' && !pathname.match(/\/issues\/\d+$/)) {
      return json(this.issues)
    }
    const issueMatch = pathname.match(/\/issues\/(\d+)$/)
    if (issueMatch && method === 'GET') {
      const found = this.issues.find(candidate => candidate.number === Number(issueMatch[1]))
      return found === undefined ? new Response('Not found', { status: 404 }) : json(found)
    }
    if (issueMatch && method === 'PATCH') {
      const found = this.issues.find(candidate => candidate.number === Number(issueMatch[1]))
      if (found === undefined) return new Response('Not found', { status: 404 })
      const body = JSON.parse(String(init?.body)) as { state?: 'open' | 'closed' }
      if (body.state !== undefined) found.state = body.state
      return json(found)
    }
    const labelsMatch = pathname.match(/\/issues\/(\d+)\/labels$/)
    if (labelsMatch && method === 'POST') {
      const found = this.issues.find(candidate => candidate.number === Number(labelsMatch[1]))
      if (found === undefined) return new Response('Not found', { status: 404 })
      const body = JSON.parse(String(init?.body)) as { labels: string[] }
      const existing = nameOf(found.labels)
      for (const label of body.labels) if (!existing.includes(label)) existing.push(label)
      found.labels = existing
      return json(existing)
    }
    const delLabelMatch = pathname.match(/\/issues\/(\d+)\/labels\/(.+)$/)
    if (delLabelMatch && method === 'DELETE') {
      const found = this.issues.find(candidate => candidate.number === Number(delLabelMatch[1]))
      if (found !== undefined) {
        const target = decodeURIComponent(delLabelMatch[2]!)
        found.labels = nameOf(found.labels).filter(label => label !== target)
      }
      return new Response(null, { status: 204 })
    }
    const branchMatch = pathname.match(/\/branches\/(.+)$/)
    if (branchMatch && method === 'GET') {
      const branchName = decodeURIComponent(branchMatch[1]!)
      return this.branches.includes(branchName)
        ? json({ name: branchName, commit: { sha: 'abc1234' } })
        : new Response('Branch not found', { status: 404 })
    }
    const commentMatch = pathname.match(/\/issues\/(\d+)\/comments$/)
    if (commentMatch && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { body: string }
      this.comments.push({ issueNumber: Number(commentMatch[1]), body: body.body })
      return json({ id: this.comments.length, html_url: `https://github.com/deepseek-ai/dsh/issues/${String(commentMatch[1])}#issuecomment-${String(this.comments.length)}`, body: body.body }, 201)
    }
    if (pathname.includes('/pulls') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { draft?: boolean, head: string, base: string }
      const number = this.pulls.length + 1
      const pull: GitHubPullRequestPayload = {
        number,
        html_url: `https://github.com/deepseek-ai/dsh/pull/${String(number)}`,
        state: 'open',
        draft: body.draft ?? false,
        head: { ref: body.head },
        base: { ref: body.base },
      }
      this.pulls.push(pull)
      return json(pull, 201)
    }
    const pullMatch = pathname.match(/\/pulls\/(\d+)$/)
    if (pullMatch && method === 'GET') {
      const found = this.pulls.find(candidate => candidate.number === Number(pullMatch[1]))
      return found === undefined ? new Response('Not found', { status: 404 }) : json(found)
    }
    return new Response('Unhandled endpoint', { status: 500 })
  }

  /** The label names currently on one issue. */
  labelsOf(issueNumber: number): string[] {
    return nameOf(this.issues.find(candidate => candidate.number === issueNumber)?.labels ?? [])
  }

  /** The state of one issue. */
  stateOf(issueNumber: number): string {
    return this.issues.find(candidate => candidate.number === issueNumber)?.state ?? 'unknown'
  }
}
