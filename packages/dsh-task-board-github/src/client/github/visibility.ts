/**
 * GitHub provider visibility: an issue whose inclusion label was removed on
 * GitHub hides from the board's active columns without deleting its history.
 * The board sums these predicates, so the rule lives with the provider instead
 * of being hard-coded in the board.
 *
 * @module dsh-task-board-github/client/github/visibility
 */
import type { TaskRecord } from '../../core/task-record.ts'
import { readTaskGitHubMetadata } from '../../core/types.ts'

/** Whether a GitHub-linked task should stay visible on the board. */
export function isGitHubTaskVisible(task: TaskRecord): boolean {
  return readTaskGitHubMetadata(task)?.deactivated !== true
}
