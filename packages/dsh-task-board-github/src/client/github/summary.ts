/**
 * The published summary this extension's browser half renders.
 *
 * The host half publishes it through the board capability face, so it rides
 * the board's own state channel and reaches the browser inside the board
 * mirror's `extensions` map. This provider therefore opens no HTTP surface of
 * its own. The store is a module singleton because one bundle instance serves
 * one extension: the seat components receive only the contract's owner props
 * (`{ task, dispatch }` / `{ dispatch }`), so the summary travels beside the
 * seats rather than through them.
 *
 * @module dsh-task-board-github/client/github/summary
 */
import { useSyncExternalStore } from 'react'
import { GITHUB_EXTENSION_ID } from '../../core/types.ts'

/** One configured repository, as the provider publishes it. */
export interface GitHubRepositorySummary {
  owner: string
  repository: string
  inclusionLabel: string
  prCreationEnabled: boolean
  hasCredential: boolean
}

/** The provider's read-only summary; every field is optional on the wire. */
export interface GitHubSummary {
  enabled?: boolean
  hasCredential?: boolean
  repositories?: GitHubRepositorySummary[]
}

/** Normalize whatever the board hands back; a foreign payload reads as absent. */
function decode(value: unknown): GitHubSummary | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const repositories = Array.isArray(record.repositories)
    ? record.repositories.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return []
        const repo = entry as Record<string, unknown>
        if (typeof repo.owner !== 'string' || typeof repo.repository !== 'string') return []
        return [{
          owner: repo.owner,
          repository: repo.repository,
          inclusionLabel: typeof repo.inclusionLabel === 'string' ? repo.inclusionLabel : '',
          prCreationEnabled: repo.prCreationEnabled === true,
          hasCredential: repo.hasCredential === true,
        }]
      })
    : undefined
  return {
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(typeof record.hasCredential === 'boolean' ? { hasCredential: record.hasCredential } : {}),
    ...(repositories === undefined ? {} : { repositories }),
  }
}

let current: GitHubSummary | undefined
const listeners = new Set<() => void>()

/**
 * Read one published summary out of the board mirror and store it.
 * @param published - the mirror's `extensions` map.
 */
export function acceptPublishedSummaries(published: Readonly<Record<string, unknown>>): void {
  setSummary(decode(published[GITHUB_EXTENSION_ID]))
}

/** Replace the stored summary; an unchanged value notifies nobody. */
export function setSummary(next: GitHubSummary | undefined): void {
  if (current === next) return
  current = next
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A subscriber must never break the extension's own bookkeeping.
    }
  }
}

/** Drop the summary (the board reports the extension is not running). */
export function clearSummary(): void {
  setSummary(undefined)
}

/** The current summary, or undefined while the extension publishes none. */
export function getSummary(): GitHubSummary | undefined {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Observe the published summary from a React component.
 * @returns the current summary, or undefined while none is published.
 */
export function useGitHubSummary(): GitHubSummary | undefined {
  return useSyncExternalStore(subscribe, getSummary, getSummary)
}
