# Agent Note: Task-board client render and lineage-gate costs

Status: implemented

## Problem

Four independent defects sat on the task board's browser half; three of them were pure cost, one made a picker permanently empty.

1. **The agent-preset roster was read but never applied.** `pushPresetOptions` (\`packages/dsh-task-board/src/client/index.ts\`) was defined and then never invoked: commit `3a64c9cf` replaced the trailing `void pushPresetOptions()` + `connection/reset` subscription pair with the equivalent model-catalog calls, and the preset invocation was not carried over. `controller.setExecutionOptions({ presets })` therefore had no live call site, so `executionOptions.presets` stayed `[]` for the page lifetime: the new-task form rendered no `optgroup` rows, the detail view's mode select offered only "inherit", the inherit label never named the deployment default, and every pinned preset was displayed as removed. The dead feed was invisible to the suite because controller-level tests inject their own options and no test drove `apply()` far enough to observe them.

2. **A fresh `Intl.DateTimeFormat` was constructed per rendered timestamp.** `formatHostTimestamp` built a new formatter on every call, and the board re-renders on every controller notification — every SSE revision frame, the 15 s SSE heartbeat, and every keystroke in the search box. Constructing an ICU formatter is roughly thirty times the cost of formatting with one, and the scheduled-card title and every detail-view timestamp paid it per render.

3. **The link-subtask picker ran the lineage gate once per candidate task, unindexed.** The candidate filter called `checkParentLink` inside `Array.prototype.filter`, and each call rebuilt a `Map` of the whole ledger (`indexOf`), rescanned it per BFS level (`descendantTasks`), and recursed through `subtreeHeight` with further full scans. On a 1000-task ledger the single render cost ~35 ms of pure predicate work.

4. **The detail overlay subscribed to the controller three times.** `TaskDetail` is rendered by the already-subscribed `TaskBoard`, yet `ExecutionSettingsSection` and `SubtaskSection` each opened their own `controller.subscribe(...)` + local `useState`. Every notification ran three `getSnapshot()` calls and three state commits for one visible overlay, re-rendering the same subtrees twice; `getSnapshot()` re-allocates `pendingTaskIds` each call, so the state identity never bailed out.

## Decision

1. **The preset feed is invoked.** `void pushPresetOptions()` runs beside `void pushModelOptions()` at mount, and the `connection/reset` handler re-reads both: a reconnect may serve a different deployment. `tests/client-option-feeds.spec.ts` drives the real `apply()` against a fake context whose connection face serves a two-row roster and asserts the roster reaches the controller the panel page receives, so a future rewrite that drops the invocation fails.
2. **Timestamps share one formatter per time zone.** `formatHostTimestamp` resolves its formatter through a module-level `Map` keyed by the time-zone id (\`''\` for the browser's own), constructing once per zone and never caching an id the browser cannot build — an unusable zone still falls back to the ISO instant for that call.
3. **The lineage gate accepts a reusable index.** `core/subtask.ts` exports `buildLineageIndex` (id lookup + direct children per parent) and every lineage query (`ancestorChain`, `taskDepth`, `directSubtasks`, `descendantTasks`, `subtreeHeight`, `checkParentLink`) takes an optional `LineageIndex`. The parameter is optional, so the Host ledger's call sites and every existing test keep the unindexed contract and verdicts; the picker builds the index once per pass and memoizes the candidate list on the ledger and the parent.
4. **The overlay owns its children's data.** `ExecutionSettingsSection` and `SubtaskSection` take the picker options, the Agent Teams availability and the task list as props from `TaskDetail`'s single subscription instead of subscribing again; no other behavior of those sections changed.

The render-time formatter, index and subscription changes preserve every value the previous code produced: the cached formatter returns identical strings, the indexed gate returns identical verdicts (pinned across nine query pairs in `tests/lineage-index.spec.ts`), and the sections read the same snapshot the overlay renders against.

## Alternatives considered

- **Delete the dead preset feed instead of invoking it.** Rejected: the picker, its labels, the inherit-with-default copy, the "removed preset" row and the Host's own preset assertions on every run all exist and need the roster; the feed was reachable in an earlier commit and was lost by accident, so restoring it repairs the shipped contract rather than adding one.
- **Cache the formatter inside the component or a React `useMemo`.** Rejected: the formatter is keyed by a value the Host owns and dozens of cards share, and the same helper is called from `TaskDetail`, so a module-level cache keyed by time zone is the smallest change that covers every call site.
- **Give the lineage gate its own indexed entry point and leave the existing one alone.** Rejected: two exported variants of one gate invite the unindexed one being called in a loop again, which is exactly the defect; the optional parameter keeps one gate with one verdict table.
- **Make `LineageIndex` mandatory and rewrite every caller.** Rejected: the Host ledger's own call sites query once per action, where building the index is pure overhead, and a mandatory parameter would churn every core test for no measured gain.
- **Memoize the whole board derivation (`TaskBoard`'s filter/partition pass).** Not adopted in this change: measured at ~215 µs for a 1000-task ledger, it is two orders of magnitude below the picker's gate and contains no quadratic term, so the measured benefit does not justify the extra state plumbing yet. The finding is recorded, not acted on.
- **Replace the two EventSource connections with the shared cross-tab leader relay.** Not adopted in this change: the relay (`shared/client/sse-leader.ts`) dispatches through named SSE `addEventListener` frames while the board's stream is the default message event, the settings card binds the same URL from a second module, and the change would add a sync-manifest target plus a settings-card error path. It is a real HTTP/1.1 connection-pool cost (two streams per tab, pooled across same-origin tabs), but it is a transport change with its own contract and needs its own evidence.

## Consequences

- The mode picker offers the deployment's real preset roster again, and the inherit option names the actual default.
- A board re-render no longer constructs ICU formatters per timestamp, and the link picker's candidate derivation drops from a quadratic gate to one index build plus one linear pass.
- One controller notification now commits state once for an open detail overlay instead of three times.
- The lineage index is an additive core API: `checkParentLink` and its siblings keep their previous call signature, and the Host ledger's fail-closed gate is unchanged.

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck` and `test`: 54 files / 608 passed, 1 skipped (pre-change baseline: 51 files / 603 passed, 1 skipped).
- New specs: `tests/client-option-feeds.spec.ts` (the roster reaches the controller through the real `apply()`), `tests/host-timestamp.spec.ts` (one formatter per zone, copy identical to the uncached construction, unusable zone still renders), `tests/lineage-index.spec.ts` (indexed and unindexed verdicts agree across nine query pairs; the picker's candidate pass stays linear at 1000 tasks).
- Fail-before guards: reverting the preset invocation fails `client-option-feeds` (`expected [] to deeply equal [ ...(2) ]`), and disabling the formatter cache fails `host-timestamp` (`expected [ 'Asia/Shanghai', …(2) ] to have a length of 1 but got 3`).
- Measured before/after, three runs each, median reported, same process and machine (darwin arm64, Node v25.8.1, vitest 4.1.11):
  - Link-picker candidate gate at 1000 tasks: **34.7 ms -> 0.3 ms** (115x; runs 40.5/34.7/34.4 vs 0.5/0.3/0.2).
  - 500 host timestamps in `Asia/Shanghai`: **10.34 ms -> 0.36 ms** (28.6x; runs 17.60/10.34/9.98 vs 0.42/0.36/0.32), with byte-identical output across all 500 values.
  - Board derivation at 1000 tasks, recorded as context for not acting on it: 215 µs median.
- Repository gates: `pnpm typecheck`, `pnpm test:standards`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm emoji:check`, `pnpm aggregate:check`, `pnpm test:scripts` (349 pass) and `pnpm libs:check` after rebuilding the `dsh-web-all` aggregate `lib/` and re-recording `scripts/lib-artifact-fingerprints.json`.

## Coverage gaps

- The preset-roster fix was not exercised in the running GUI; the roster now reaches the controller, which is what the picker reads, but the rendered `optgroup` rows were not captured in a browser.
- The subscription consolidation is asserted only through the unchanged rendering specs; the reduction from three state commits to one is argued from the code path, not instrumented.
- Both performance numbers are process-local measurements, not browser render timings: they establish the removed cost, not the end-to-end frame time.
- The two-EventSource connection-pool finding, the detail view's repeated `getSnapshot()` reads, and the search-box re-derivation of the whole board are recorded above and remain unfixed.
