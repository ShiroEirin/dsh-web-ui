# Agent Note: Task-board roster polling stands down on an idle board

Status: implemented

## Problem

Issue #1821: the DeepSeek Harness host child process held about one CPU core (Activity Monitor 103.6%, continuous `top` samples 80.7%–119.7%) on macOS ARM64 with DSH 0.2.0-rc.2 and the aggregate `dsh-web-all@0.4.5`, while nothing was being run from the board. The reported chain was concrete: `TaskBoardHostService` registered an unconditional 5 s `SESSION_POLL_MS` interval, `pollSessions` called `runner.listRunning()` whenever the board was enabled, and `listRunning` calls `session/list`, which rebuilds a summary for every persisted session (the reporter's machine held ~195 session directories and ~258 session locks). The `sample` output landed in `uv__stream_io` → V8 string encoding and `uv_fs_stat`, which is exactly the cost of a full roster rebuild every 5 s. Local host HTTP requests timed out during the same window. The reporter explicitly withheld an A/B proof, and the run below does not claim one either.

The requirement was not "poll less often" but "do not poll when there is nothing to poll for": an empty board with no running card, no open execution and no armed schedule has no use for the session roster at all.

## Decision

1. **The roster poll is gated on the ledger, not on the master switch (#1821).** `HostTaskLedger.runtimeView()` now reports `needsSessionState` (an open execution to inspect, or a card in the running column whose verdict may arrive from a settle this process never saw) and `openSessionIds` (every open execution's session, including the deferred cascade parents `openExecutions` skips). `TaskBoardHostService.pollSessions` reads the roster only when `needsSessionState` holds. The running-column term is not padding: a settle performed by another process — another DSH instance on the same ledger, an agent tool call, a card moved by hand — never reaches this service's listeners, so the poll is the only path that can observe it.
   The gate deliberately does **not** consult the extension registry. The provider face (`TaskBoardExtensionHost`) exposes tasks, integrations, events, publish and tool registration, and no session capability, so no provider can have work for this roster; keeping extensions in the gate would have disabled the fix for every deployment that has one installed.

2. **The cadence became a setting.** `sessionPollSeconds` (schema default 5, range 1..300, volatile) bounds how long a running card may wait for its verdict; `src/core/poll-cadence.ts` owns the bounds, the default and the seconds-to-milliseconds conversion so the Host and the settings card validate against one source. A cadence commit re-arms the recurring timer instead of waiting out the old interval.

3. **A failed pass backs off.** The fixed heartbeat retried a failing `session/list` — including the five-attempt `service-unavailable` window inside `listRunning` — on the same cadence forever. The pass now reports whether it could read the roster (a transport throw, or `{ known: false }`), and a failure arms a doubling delay capped at one minute; the first readable pass clears it. The same accounting covers the reuse probe below.

4. **Session reuse reads the roster for its own launch.** `idleSessionIds` (the last poll's idle set) is gone: with an idle board no longer polling, a cached roster could be hours old and either refuse a session that had been idle all along or prompt into one that started running since. `reuseSessionFor` reads the roster at launch for cards that opted into `reuseSession`, and any read failure mints a fresh conversation, which is what an unknown roster always did. A card without the opt-in reads no roster at all.

## Alternatives considered

- **Raise `SESSION_POLL_MS` or make it configurable only.** Rejected: the reporter's cost is per-pass, not per-interval — a longer interval still rebuilds every persisted session row, and the ask was explicitly "no polling when there is nothing to poll for".
- **Cache or incrementally maintain the roster inside the plugin.** Rejected: the roster's authority is the DSH session tree, and a plugin-side cache would either serve stale session state to execution settlement or need invalidation events the SDK does not expose. The gate removes the reads; it does not re-implement the roster.
- **Skip the roster read only while the board is disabled.** Rejected: the reported CPU is on an *enabled* board with an empty ledger — the disabled path was already the documented workaround, not a fix.
- **Keep `idleSessionIds` and accept staleness.** Rejected: it makes reuse depend on when the board last had work, which is exactly the behaviour the gate removes, and a stale "idle" verdict would prompt into a session another window is using.
- **Gate on `extensions.hasActiveExtensions()` as well.** Rejected after checking the provider contract: the extension host face carries no session capability, so the term only weakened the fix. `hasActiveExtensions()` was written, then removed with its test.
- **Reuse `shared/host/poll-guard.ts`.** Rejected: its deadline and failure-cap semantics fit the bounded git-graph loops, not a loop that must run for the Host's whole lifetime. The behaviour it owns there (anti-overlap and failure backoff) is implemented here against the board's own timer face, which cordis binds to the owning fiber.

## Consequences

- An idle board reads no session roster at all: no per-session summary construction, no per-record stat, no allocation churn behind it. A board with work polls at `sessionPollSeconds`.
- The power snapshot's `runningSessions` count freezes at its last read while the board is idle. This is deliberate: it is what keeps the optional idle-sleep assertion held rather than flapping, and a stale count only delays the release of that assertion, never starts one. The first pass after work appears refreshes it.
- Settlement latency for a running card is unchanged in kind — it was already bounded by the poll cadence — and the cadence is now the user's choice.
- A session tree that is down is retried with growing delays instead of every few seconds, and a recovered tree clears the ramp.
- Session reuse now costs one roster read per opted-in launch instead of reading a value captured by the previous poll. Cards without the opt-in are unaffected.
- The aggregate package inlines this client bundle, and `packages/dsh-web-all/lib` is committed build output, so it is rebuilt and its fingerprint re-recorded in `scripts/lib-artifact-fingerprints.json` in the same change. `packages/dsh-task-board/lib` is git-ignored and stays local.

## Testing

- `packages/dsh-task-board/tests/poll-cadence.spec.ts` pins the cadence bounds: the default, clamping below and above the range, truncation, and non-finite input never disabling the poll.
- `packages/dsh-task-board/tests/host-service.spec.ts` pins the behaviour end to end against gateway doubles: an empty board reads the roster zero times across repeated passes; a card parked in the running column does read it; a pass after a run resumes reading it; the recurring timer is re-armed at the new cadence when `setConfiguration` commits one; and consecutive failing passes arm 10 s, 20 s, 40 s retries that a readable pass clears so the next failure starts at 10 s again.
- `packages/dsh-task-board/tests/host-ledger.spec.ts` pins the projection itself: the new `openSessionIds`/`needsSessionState` fields on the existing detached-projection case, and a settled board reporting `needsSessionState: false` that flips to `true` when a card is parked in the running column.
- The reporter's A/B measurement (task board disabled versus enabled, same host) is not reproducible in this repository: it needs their machine, their 195-session home directory and their DSH build. The coverage above is mechanism-level, and the issue comment reports it as such.
