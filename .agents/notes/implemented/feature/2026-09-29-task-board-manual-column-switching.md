# Agent Note: Manual column switching on the task board

Status: implemented

## Problem

The board's five columns had two owners. `backlog` and `todo` belonged to the operator; `running`, `done` and `failed` belonged to the execution runner. `MANUAL_STATUSES` was `['backlog', 'todo']` and every guard and affordance that meant "the runner owns this card" was written as `status === 'running'`: the ledger's move/delete/archive/run refusals, the cascade participant filter, the set-parent lock, the drag source, the run button, the subtask detach lock, the card spinner.

That split assumed a card's state is produced by a Host-run session. Boards carry work that is not: a patent filed through an external agency, a paper submitted by a human, a review decided in a meeting, a test executed by hand. Such a card could be labelled "待办" or "已完成" but never "进行中" — the board only showed in-progress when the Host itself was running something, so an operator tracking outside work had to choose between an understated column and a false one.

The obvious relaxation is not enough on its own. If `running` becomes a plain column while the guards keep reading the column, a card parked there by hand becomes unrecoverable: `run` refuses it (it looks busy), `move` refuses it, `archive` and `delete` refuse it, and `settle` refuses it because there is no open execution to close. The lock had to move off the column text before the column could be free.

## Decision

A card may be moved by hand to any column but the one it already shows. What "the runner owns this card" means is an open execution record, never the column text.

### One predicate, three surfaces

- `MANUAL_STATUSES` is every status. `canMoveManually(from, to)` accepts any column that is not the current one, and `canMoveTask(task, to)` adds the two conditions that make a move legal at all: the card is on-board and holds no open execution. `canMoveTask` is the single owner of "may this card move", so the ledger, the detail view's status row and the board's drop handler cannot disagree.
- `hasOpenExecution(task)` moves from a private helper in `host-ledger.ts` to `core/tasks.ts`, where the client half can reach it too.
- The agent tool surface exposes `move-backlog`, `move-todo`, `move-running`, `move-done` and `move-failed`; all five map onto the same `move` protocol action, which already carried a `TaskStatus`, so the wire format is unchanged.

### The lock is the execution

Every guard that read `status === 'running'` now reads `hasOpenExecution`: the ledger's move, delete, archive/restore subtree check, run/rerun and cron-trigger gates, cascade participant selection and launch, the set-parent lock, and restart reconciliation. The client follows the same rule for the drag source, the card spinner, the run button, tag editing, the subtask detach lock, the subtask roll-up's "running" count and the link-subtask candidate list.

A card parked in the running column by hand therefore stays fully operable: it can be moved, archived, re-parented, deleted, edited, and run — a run opens a real execution and settles the column with a recorded outcome. A card with an open execution refuses all of those exactly as before, and `settle` remains the only way out of one the board can no longer observe.

Restart reconciliation drops its `status === 'running'` pre-filter: any open execution that still has no session id after a restart — or on import — is cancelled, fail closed, whatever column the card shows. A stored session-less execution therefore no longer survives import, and the "awaiting session" projection the runtime view serves is produced by a live launch.

### A declaration, not a recorded verdict

A manual move writes the column through `withStatus` and nothing else: no execution record, no schedule change, no touch of the execution history. `done`/`failed` declare that the work finished (or failed) outside a Host-run execution; `running` says the work is under way without a tracked session. The card's execution list keeps the two provenances distinguishable, the next settled run overwrites the column with the recorded outcome, and the durable format is unchanged (`schemaVersion` stays 4, no migration).

## Alternatives considered

**Keep the running column runner-owned and allow only the planning and verdict columns.** Rejected: it leaves work that is genuinely under way unrepresentable, which is exactly the case the change was asked for — an operator tracking work performed outside DSH could only pick a column that understates or overstates it.

**Allow `running` as a column while the guards keep reading the column.** Rejected: a hand-parked card would be unrecoverable (run, move, archive, delete and settle all refuse it, and there is no execution for settle to close). Freeing the column and moving the lock are one change, not two.

**Add a durable provenance field for a declared status.** Rejected: the ledger format is versioned, so the field would need load-time normalization and clearing on the next settled run, and every reader would have to learn it. The execution history already separates a declaration from a run.

**Mark a hand-parked running card with its own flag or tone.** Rejected for now: the detail view already shows whether an execution exists, and a durable flag would have to be cleared by the settle path that overwrites the column — more state for no additional truth.

## Consequences

- Every column is switchable by hand, from the board (drag), the detail view (status buttons) and a conversation (`task_board_manage`), and the same three surfaces refuse a move together.
- The running column carries two meanings: work the Host is executing (an open execution, with a session and a spinner) and work declared under way by hand (no execution). The detail view's execution list is what separates them.
- Cards with an open execution are locked exactly as before, and the failure messages a client sees are unchanged.
- Import stops preserving a session-less open execution; such a row is cancelled at boot instead of lingering as an unobservable run.
- Content editing now freezes at the first execution record rather than at the `running` column, so a card parked in `running` by hand can still be corrected.

## Testing

`tests/tasks.spec.ts` pins both predicates (every column reachable, the current column and an executing/archived card refused), `tests/host-ledger.spec.ts` parks a card in `running` by hand and moves it back, records a manual `done` with an empty execution history, and drives the runtime projection from a live session-less launch after the import normalization changed, `tests/controller.spec.ts` runs a hand-parked card and still refuses a second launch while an execution is open, `tests/agent-tools.spec.ts` drives `move-done` and asserts `executionCount` stays 0, and `tests/board-view.spec.tsx` drops a card onto the Done and the Running columns while refusing to drag an executing one. The package typecheck, test suite and build pass, together with `pnpm docs:check` and `pnpm i18n:check` (the move labels are mirrored in the Russian dictionary).
