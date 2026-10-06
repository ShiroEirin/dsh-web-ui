/**
 * Structural view of the task-board vocabulary this extension reads.
 *
 * The extension is a separate bundle and may not import the board's internals,
 * so it restates the record shape the provider contract hands it. These are
 * read-only structural declarations: the board's own values satisfy them and
 * nothing here is constructed by the board. The single source of truth for the
 * contract remains the board's `src/core/extension.ts`.
 *
 * @module dsh-task-board-github/core/task-record
 */

/** Column a card occupies. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

/** Settlement of one execution. */
export type ExecutionOutcome = 'succeeded' | 'failed' | 'cancelled'

/** One execution of a card, as a provider reads it. */
export interface ExecutionRecord {
  /** Stable execution id. */
  id: string
  /** Session the execution runs in, once one was opened. */
  sessionId?: string
  /** Instant the execution started (ms epoch). */
  startedAt: number
  /** Instant the execution settled (ms epoch). */
  settledAt?: number
  /** Settlement, absent while the execution is still running. */
  result?: ExecutionOutcome
}

/** One card, as a provider reads it through the capability face. */
export interface TaskRecord {
  id: string
  title: string
  description: string
  prompt: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  /** Parent card id, when this card is a subtask. */
  parentId?: string
  /**
   * Workspace the execution must run in, when the card pins one. Read-only
   * here: a provider sets it by pinning it on the draft it creates with.
   */
  workspaceId?: string
  /**
   * Qualified provider/model the card pins for its execution, when it pins
   * one. Read-only here: the provider uses it as the route of the issue
   * analysis it writes for the card.
   */
  model?: string
  /** True for a card the board keeps off the board view. */
  hidden?: boolean
  /** Instant the card was archived (ms epoch), absent while it is live. */
  archivedAt?: number
  /** Every execution this card has had, oldest first. */
  executions: ExecutionRecord[]
  /**
   * The board's native tags. Provider labels never land here: a remote label
   * set has no 8-tag limit and no promptPrefix channel, so it stays in this
   * extension's own payload.
   */
  tags?: ReadonlyArray<{ name: string }>
  /** Opaque provider payloads, keyed by extension id. */
  integrations?: Record<string, unknown>
}
