/**
 * Timer seat the synchronization service schedules through.
 *
 * The extension never reaches for a global timer directly: a deployment (or a
 * test) injects the timer face, so background polling is observable and
 * cancellable without patching globals.
 *
 * @module dsh-task-board-github/core/timers
 */

/** The timer operations the provider needs, each returning its own canceller. */
export interface HostTimerFace {
  /** Run `callback` once after `delay` ms. */
  timeout(callback: () => void, delay: number): () => void
  /** Run `callback` every `delay` ms. */
  interval(callback: () => void, delay: number): () => void
}
