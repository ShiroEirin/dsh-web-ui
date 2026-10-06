/**
 * Degradation ledger for the dsh-web-all shell. One record per family plugin
 * that failed to import, start, or lost its fiber after activation. The shell
 * writes it; doctor and the plugin manager read it to surface "this plugin is
 * degraded, the rest of the Web is healthy" instead of relying on log scraping.
 */
export interface DegradedRecord {
  /** Real plugin package name from the shell row config. */
  plugin: string
  /** Where the failure happened: module import, plugin shape, or fiber start. */
  stage: 'import' | 'shape' | 'start'
  /** Failure message (stack when available). */
  message: string
  /**
   * One-line failure reason, for consumers that RENDER it: the health route
   * serves this field so a plugin's own panel can name why its row degraded.
   * Additive to the record shape — readers that predate it keep using
   * stage/message.
   */
  reason: string
  /** ISO timestamp of the most recent failure for this plugin. */
  at: string
}

import { shellState } from './state.ts'

/** Longest recorded reason; a reason is one line of copy, not a stack dump. */
export const DEGRADED_REASON_MAX = 500

/**
 * Compress a thrown value into the one line a UI can render: the first
 * non-empty line of the message, bounded. The full stack stays in `message`
 * for the log and for tooling that wants it.
 * @param error - the caught value.
 * @param maxLength - bound on the returned string.
 * @returns one line naming the failure, never empty.
 */
export function failureReason(error: unknown, maxLength: number = DEGRADED_REASON_MAX): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = (text.split('\n', 1)[0] ?? '').trim()
  const reason = line === '' ? 'unknown failure' : line
  return reason.length <= maxLength ? reason : reason.slice(0, maxLength - 3) + '...'
}

/** Record (or refresh) one plugin's degraded state. Errors are logged here once. */
export function recordDegraded(plugin: string, stage: DegradedRecord['stage'], error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(`[dsh-web-all] plugin degraded (${stage}): ${plugin}\n${message}`)
  shellState().degraded.set(plugin, { plugin, stage, message, reason: failureReason(error), at: new Date().toISOString() })
}

/** Clear one plugin's degraded record (successful start after a retry/HMR reload). */
export function clearDegraded(plugin: string): void {
  shellState().degraded.delete(plugin)
}

/** Snapshot of all currently degraded plugins. */
export function listDegraded(): DegradedRecord[] {
  return [...shellState().degraded.values()]
}

/** For test teardown and test isolation only. */
export function _resetDegradedForTest(): void {
  shellState().degraded.clear()
}
