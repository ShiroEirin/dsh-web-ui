# Agent Note: Task-board agent tools

Status: implemented

## Problem

The board was operable only from its Web GUI. The Host already owned the ledger, the cron scheduler and the execution runner, and the plugin already announced itself to agents through a system-prompt section — yet an agent asked to put work on the board or to run a card could only tell the user to click. Every board operation, including the subtask relation shipped in the same release train, was unreachable from a conversation, so the agent could plan board work but never act on it.

## Decision

`src/host/agent-tools.ts` defines eight model-facing tools, and the plugin activation registers them into the tool registry while the board is enabled. They are bound to the same `TaskBoardHostService` the browser drives, so a task created in the GUI is immediately visible to agents and vice versa, and no rule is reimplemented at the tool layer. The lineage rules these tools expose are owned by [task-board-subtasks](2026-09-24-task-board-subtasks.md).

### Tool surface

- `task_board_list` filters cards by column, parent, roots only, label, free-text query and archived state, and returns the board summary (revision, time zone, subtask depth limit, session-default permission, column counts).
- `task_board_get` reads one card in full: prompt, labels, parent link, direct subtasks, depth, execution targets, schedule, permission-gate state, continuation-card snapshot and handover references, and the last ten executions with their session ids, initiator and outcome.
- `task_board_create` creates a task, or a subtask with `parentId`; unset execution targets inherit the parent and the depth gate applies.
- `task_board_update` edits content, labels and execution targets; an empty string clears a target and an empty label array clears the labels.
- `task_board_set_parent` links an existing card under a parent, or detaches it with an empty parent id.
- `task_board_run` runs a card now, or re-runs a settled one, cascading over its whole subtask tree.
- `task_board_manage` moves a card between backlog and todo, archives, restores, or deletes it.
- `task_board_schedule` arms, changes, or disarms the card's cron rule.

### Registration and failure tolerance

- Registration follows the `enabled` master switch: a disabled board answers no tool call, and switching the board off disposes the tool registrations on the same commit path that toggles the announcement.
- The tool registry is resolved as an optional service instead of being listed in `inject`, mirroring how the optional `llm` service is resolved: a deployment whose runtime serves no registry still mounts the whole board and loses only the tool surface. Where the runtime offers scoped injection, a late-arriving registry is followed through it.
- Tool calls drive the Host service in process rather than the browser HTTP fence, so there is no second transport to keep in sync; the service's own active flag and the ledger gates remain the only authorities.

### Refusals and the human gate

- Domain refusals are returned as `ok: false` values with a code and the Host message, so the model can correct itself instead of reading a thrown error.
- There is deliberately no `confirm-permission` tool. The gate exists so a human lifts an above-default permission binding; an agent able to stamp it would make the gate decorative, and `task_board_run` answers `confirmation-required` instead. Nor can the surface transfer one: an inherited binding stays on the ancestor and is resolved at launch, so a subtask an agent creates and then detaches carries no binding and no confirmation with it.
- The depth gate, the running-task locks, the archive and delete guards and the fail-closed pins are reached through the same ledger actions the UI uses, so the tool surface cannot bypass them.

### Attribution

- A tool call reads the calling session id from the execution context and passes it as the action initiator, so a run records it as the execution initiator and a create or update stamps it into a continuation card's snapshot.
- The initiator stays audit metadata: it is asserted by the browser for GUI actions and by the calling agent here, and no gate depends on it.

## Alternatives considered

**Calling the board's own HTTP API over loopback from the tools.** Rejected: it would add a second transport, drag in the same-origin marker and the proxy token handling, and make a local function call fail for reasons that have nothing to do with the ledger. The host half already holds the service.

**One composite tool with an action enum for every operation.** Rejected: a single schema with twenty optional fields is harder for a model to fill correctly than eight focused schemas, and the descriptions carry the safety notes (quota, gates) a composite would have to cram into one string. The ssh tool surface in this family made the same choice.

**Listing `tools` in `inject` so the row waits for the registry.** Rejected: it would turn a missing optional registry into a failed plugin mount, the failure mode this package already avoids by resolving `llm` optionally. The GUI and execution do not depend on the tool surface.

**Exposing `confirm-permission` so an agent can unblock itself.** Rejected: that gate is the package's only human-in-the-loop control for above-default permissions, and an agent that can set the flag is not a control at all.

**Exposing continuation-card creation (freeze snapshots and handover bundles) as tools.** Deferred, not built: those payloads are produced by a session's own freeze block and are already insertable through the browser form, and a model-written freeze constructor would widen the prompt-injection surface for no capability the board lacks.

**Registering the tools unconditionally, ignoring `enabled`.** Rejected: the master switch means the board is not running, and a tool that answers while the UI is hidden would be a second, disagreeing source of truth.

## Consequences

- A conversation can now consume real API quota: `task_board_run` starts real sessions, and a subtask tree starts one per member.
- The tool surface adds eight short descriptions to every enabled agent's context, each naming its triggers, including the Chinese board vocabulary.
- Because the tools reuse the ledger actions, an agent cannot reach a state a user could not: every GUI refusal is reachable and every gate still holds.
- Runs and edits are attributed to the calling session, so a board audit can tell agent-initiated work from a GUI click.
- Required verification: `tests/agent-tools.spec.ts` covers construction and the deliberate absence of a confirmation tool, listing and get projections, subtask creation and inheritance, the depth refusal, link and detach, a cascade run with one session per member, the `confirmation-required` refusal, initiator attribution, archive and delete guards, scheduling, partial updates, and the disabled-board refusal; package `typecheck`, `test` and `build` are the gates.
