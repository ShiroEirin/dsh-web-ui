# Agent Note: Task-board workspace inheritance

Status: implemented

## Problem

A card whose workspace pin is empty ran outside the project it belonged to. Two
paths produced it, and both trace to the same line of the runner:

1. `HostExecutionRunner.launch()` passed no `workspaceId` at all for an unpinned
   card, on the documented belief that the Host then resolves "the most recent
   workspace". The Host does not: `create()` in
   `@deepseek-ai/dsh-api-session-controller` computes
   `const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd`, so such a run
   landed in the Host process working directory — the profile directory
   (`~/.dsh/profiles/desktop`) in the desktop app. Observed on 2026-09-30: a card
   created from a session working in `~/code/dsh-web` executed in
   `~/.dsh/profiles/desktop`, and the session store recorded it under
   `~/.dsh/sessions/--Users-zcl-.dsh-profiles-desktop--/`.
2. Only the browser new-task form ever filled the pin (the open project, or an
   explicit choice). A card written through the agent tool `task_board_create` —
   how a scheduled card is normally created while in conversation — arrived with
   no pin, so every run of it took the path above.

The user-visible contract to restore: a card that names no workspace runs in the
workspace its creator was in.

## Decision

**A root card created through the board action path inherits the workspace of the
session that created it.** `TaskBoardHostService.apply()` runs an incoming create
action through `withInheritedWorkspace()` before the ledger sees it: when the
action is a create, carries an initiator session id, has no `parentId`, and pins
no `workspaceId`, the service resolves the workspace owning that session
(`workspaceOwningSession()`) and pins it on the card. The agent tool already
submits `callingSessionId(exec)`, and the browser submits the main view's session,
so one rule covers both writers. The initiator is client-asserted and only
selects among workspaces the deployment already lists.

**A run whose pin is still empty resolves the most recently used workspace
instead of omitting `workspaceId`.** `HostExecutionRunner.launch()` falls back to
`mostRecentWorkspaceId(registry.list())` — the workspace whose record changed last,
since attaching a session stamps `updatedAt` — with the deployment's own list
order breaking ties. This covers cards written before this change, imported
cards, and creators no workspace can resolve. Only a deployment that serves no
workspace registry, or has registered none yet, still leaves the choice to
`session.create` and therefore to the Host working directory.

Both rules live in the framework-free `src/core/workspace-target.ts` and read a
structural subset of the SDK `Workspace` entity, so the browser program compiles
them without an SDK value import.

The most-recently-used fallback is a LAST resort, not an answer: it is correct
only when the card has no better fact. A card materialized by the GitHub
extension has one — its repository — and the extension now uses it, pinning the
card to the workspace whose directory name matches through its own pure rule
(`packages/dsh-task-board-github/src/core/workspace-match.ts`, recorded in that
package's own note). The board is unchanged by that: an extension that pins a
workspace simply arrives with one, and a card that does is still covered by the
two rules above. Both agree on what a pin MEANS; they never contend over who
may set it.

## Testing

- `tests/workspace-target.spec.ts` — session ownership, recency selection, ties,
  unreadable stamps, and the empty registry.
- `tests/host-runner.spec.ts` — an unpinned launch creates its session in the most
  recently used workspace; a registry-less deployment still issues a bare create.
- `tests/host-service.spec.ts` — a root creation from a session pins that session's
  workspace even when another workspace is more recent; an explicit pin wins; a
  subtask keeps inheriting its lineage.

## Alternatives considered

- **Fix only the runner (resolve the recent workspace at execution time).**
  Rejected as the whole answer: it satisfies the documented "most recent
  workspace" label, but a daily scheduled card would then follow whichever
  project the user last touched — for a card whose job is maintaining this
  repository's satellites, running in an unrelated checkout repeats the surprise
  the report described.
- **Pin the creator's workspace in the browser only.** Rejected: the agent tool
  path never passes through the browser, and the two writers would drift apart.
- **Make the workspace field mandatory when no project is open.** Already rejected
  by [the project-partition note](../../feature/2026-09-13-task-board-project-partition.md):
  leaving the pin empty is what keeps a card writable without a project choice.
  Inheriting silently preserves that property.
- **Resolve "most recent" from the session catalogue instead of the workspace
  record.** Rejected: it would add a roster read and a session-to-workspace
  mapping to every launch for a marginally better signal, while `updatedAt` is
  already the workspace record's own mutation stamp.
- **Trust the initiator as authority.** Rejected: it stays a hint used only to
  choose among workspaces the deployment already knows, so a forged id can
  neither register a workspace nor reach a directory outside the list.

## Consequences

- A card created by an agent inside a project now shows that project as its
  pinned workspace, so the project filter and the execution target agree.
- The `task_board_create` tool description, the `NewTaskInput.workspaceId`
  doc comment, and the README bullet on the project partition state the
  inheritance instead of promising a "most recent workspace" the Host never
  implemented.
- An unpinned card's target can still change between runs, because it follows the
  recent workspace; pinning a workspace remains the way to freeze it.
- `TaskBoardHostService.apply()` reads the workspace registry once per root
  creation — a synchronous scan of the deployment's workspace list.
