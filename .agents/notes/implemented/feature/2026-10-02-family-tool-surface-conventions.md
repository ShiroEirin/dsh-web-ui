# Agent Note: Family tool-surface conventions

Status: implemented

## Problem

Five plugin packages in this repository register model-facing tools (24 in total: the eight `task_board_*`, the seven `task_board_github_*`, the six `ssh_*`, `git_worktree`, and the two preset-scoped LiangShen tools). Each did so with its own local conventions, and three of them had drifted from how the official tool packages behave:

- Every tool description carried a `Triggers: <keyword list>` trailer (21 occurrences), mixing retrieval hints into the tool's semantic contract. No official tool has one.
- Three packages hard-coded their own prompt-section order (150 / 200 / 210) with no shared definition, and the announcement rendered as a plain string.
- The announcement therefore did not follow tool visibility: a deployment whose tool registry was absent, or a scope whose tools were restricted away, still received guidance naming tools it could not call.
- Fifteen tools declared `output: { schema: { type: 'json' } }`, opting out of the registry's canonical output contract that `defineTool` otherwise enforces.

## Decision

`shared/host/tool-surface.ts` (synced by `scripts/sync-shared.mjs` into `dsh-ssh`, `dsh-task-board` and `dsh-task-board-github`) owns the two conventions these packages share:

- `PLUGIN_TOOL_SECTION_ORDERS` holds one order per host plugin (`ssh: 150`, `task-board: 200`), and `EXTENSION_TOOL_SECTION_ORDER` (210) is the slot an external provider extension's own guidance section takes right after the plugin it extends. Host bands cannot drift into an accidental tie, and an extension names itself rather than its host, so no package's synced copy of this module carries a provider id (see [Task Board external provider extension contract](../architecture/2026-09-30-task-board-extension-contract.md)).
- `visibleToolText(tools, names, text)` returns a section provider that renders `text` only while at least one of `names` is reachable through `tools.get(name, context.scope)`. A deployment serving no registry renders the text unchanged (a missing registry is not proof the capability is unusable), and a refused lookup also renders it (a transient read failure must not silently drop the announcement); only a successful lookup that finds none of the names renders empty.

All 21 `Triggers:` trailers are removed from tool descriptions. The trigger vocabulary they carried already lives in each package's own `*_GUIDANCE` announcement (`SSH_GUIDANCE`, `TASK_BOARD_GUIDANCE`, `GITHUB_GUIDANCE`), which is the documented home for "the words that name this plugin" — so no user-facing capability discovery is lost, and the copy is no longer paid for twice.

### Registration stays global

Tools keep registering through the plugin's own `ctx` (the global layer), not per `agent.ctx`. This matches 21 of the 22 official tool packages; only `dsh-experimental-tool-agent-team` installs per agent, because its tools belong to a membership that must be resolved before they are visible. The family's tools are plugin-capability surfaces with no membership predicate, and the registry's per-scope `restrict()` mask filters **inherited global** tools while explicitly rejecting scope-local names — so moving these tools into each agent's own layer would remove them from the reach of the one restriction mechanism that can currently withhold them (LiangShen's tool paging, which relies on `restrict({ deny })` to hold `mcp__*` families off the wire).

### Concurrency and cancellation

`ssh_list`, `task_board_github_list` and `task_board_github_get` declare `isConcurrencySafe: () => true`: each is a pure projection of an in-memory/locally-configured registry, so overlap cannot interleave state, and the registry's contract is fail-closed (anything but an exact `true` is exclusive).

The SSH engine forwards the caller's `exec.signal` through `SshEngine.exec` / `cluster` into `execCommand`. Aborting closes the remote channel and settles the call as `success: false` with `command cancelled by the caller`, not as a dropped connection; `withClient` refuses to retry an aborted call, because its reconnect path can replay a non-idempotent remote command (the package's documented trade-off) and a caller that asked to stop must not have it re-run.

## Alternatives considered

**Registering per `agent.ctx` to match the Agent Teams tool package.** Rejected for the reason above: it is correct only for membership-scoped tools. For plugin-capability tools it silently removes them from `restrict()`'s reach (the API rejects scope-local names), which is a capability regression rather than an improvement. The Agent Teams package's own README describes `restrict` as filtering what a scope *inherits*, and the registry documents the own-layer exemption as existing precisely so a child's filter never strips the machinery that child answers through — not as a licence to move unrelated capability tools out of filter range.

**Keeping the `Triggers:` trailers and appending a policy section.** Rejected: it pays twice for the same vocabulary. The announcement already states the capability and the words that name it, and the tool description should state what the tool does.

**Rendering the announcement unconditionally and relying on the `enabled` switch alone.** Rejected: the switch and tool visibility are different questions. A board can be enabled while its tool registry is absent (the board resolves the registry as an optional service by design), which is exactly the state that produced guidance for uncallable tools.

**Adding `presentCall` card projections to these tools.** Not built. The shipped Web client does not consume `presentCall`, `presentResult`, or a `tool.call.toolview` field: a probe of the installed `app.asar` finds zero references in `dsh-client-ui-conversation/lib/client.js`, `dsh-web-app/lib/index.js`, and `dsh-app-boot/lib/index.js`. The registry's own README records that the built-in Web client derives card props from raw arguments and result content, selecting a renderer through `tool.call.toolview` — a field nothing in this deployment reads. Adding the callbacks would be unobservable code; the decision is left to the SDK/web layer.

**Replacing the 15 `{ type: 'json' }` output schemas with precise ones in this change.** Deferred, not rejected. `defineTool` requires an `output` declaration and validates successful values against it, so a precise schema is the stronger contract (25 official tools use one). The board and GitHub tools return deeply nested, partly-optional projections (`taskSummary`, `taskDetail`, `githubTaskSummary`, execution records) whose exact schemas are a much larger change than the rest of this note and would need their own projection tests. They keep `{ type: 'json' }` for now, which preserves the mandatory-declaration contract without a schema that could reject a legitimate projection.

## Consequences

- Three packages share one definition of where their guidance sits and when it renders; each host band keeps its own order and an extension's section takes the family extension slot after its host.
- Announcements stop naming tools a session cannot reach. All three default `announceToAgent` to `false`, so this only affects users who opted in.
- Tool descriptions no longer carry retrieval keywords; the same vocabulary remains in the announcements.
- A cancelled `ssh_exec` / `ssh_cluster` call now stops the remote command instead of leaving it running, and is never replayed by the pool's reconnect retry.
- Verification: `packages/dsh-ssh/tests/tool-surface.spec.ts` and `packages/dsh-task-board/tests/guidance-visibility.spec.ts` cover the shared gate (visible, withheld, absent registry, throwing registry, empty name list); `dsh-ssh/tests/engine.test.ts` adds abort-during-run and already-aborted cases; the three packages pass `typecheck`, `test` and `build`, and `node scripts/sync-shared.mjs --check` guards the shared copies.
