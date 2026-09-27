# Agent Note: Issue batch 1707-1708 — document-relative client routes and honest reuse-execution outcomes

Status: implemented

## Problem

Two reports, both reproduced against this checkout before any edit.

**#1707 — client routes escaped a sub-path deployment.** The harness serves the Web GUI with one document base, `<base href="./">` (`packages/host/frontend-static/src/index.ts`, `renderIndex`), so the served index works at the origin root *and* under any prefix a reverse proxy mounts it at. The official client honours this: `packages/client/connection/src/client/rpc.ts` posts `${channel}/${endpoint}`.slice(1) — a document-relative route with no leading slash. This repository's plugins instead wrote root-absolute literals (`/api/dsh-skill-explorer/list`, `/git/status`, `/api/pair/status`, `/api/update/status`, `/api/task-board/state`, `/api/market/install-*`, `/api/dsh-usage/*`, `/api/dsh-session-archive/*`, `/api/plugin-manager/*`, `/api/dsh-web-all/rows`, and two `EventSource` URLs). A root-absolute path resolves against the origin, not the mount, so under `/dsh/dsh` every one of those calls missed the host route — the reporter's `/api/dsh-skill-explorer/list` never reached the plugin.

**#1708 — a failed reuse execution was recorded as `succeeded`, and the reuse branch skipped the preset assertion.** `HostExecutionRunner.inspect` decided the outcome from the newest `turn/end` inside the execution window, and `isErrorTurnEnd` returned true only for `reason.kind === 'error'`. Every other reason the harness can append — `aborted`, `blocked`, `max-tokens`, `interrupted`, `forked` — fell through to `{ outcome: 'succeeded' }`. `interrupted` is exactly what a restart produces: `interruptedTurnClosers` in `packages/core/session/src/repair.ts` synthesizes it for a persisted log whose tail turn never ended. So a cron execution that died during resume was stamped successful and the schedule failed silently, which is the observability failure the reporter hit. The same predicate accepted an unreadable payload as success. Separately, the reuse branch re-asserted only the pinned permission and model (`pinAndPrompt`); the fresh branch passes `agentPreset: mode` to `session/create`, so a reused session composed from a different preset continued under the wrong composition with no diagnostic.

The test fixtures had hidden the classification bug: five `turn/end` fixtures used `reason.kind: 'complete'`, a value that has never existed in the harness (the union in `packages/core/session/src/types.ts` declares `completed`). The permissive predicate made those fixtures pass.

## Decision

**Client routes are document-relative, and a shared constant is derived rather than duplicated.** Every same-origin route a plugin's browser half posts drops its leading slash, matching the official client. `dsh-task-board` keeps the host's root-absolute `TASK_BOARD_API_PREFIX` for route registration and derives `CLIENT_API_PREFIX = TASK_BOARD_API_PREFIX.slice(1)` in `src/client/host-api.ts`, so the two halves cannot drift. `dsh-skill-explorer`'s `contract.spec.ts` drift guard normalizes the relative literal back to a root-absolute path before comparing it with the host `ROUTES` table, and additionally asserts no root-absolute `'/api/` literal returns. At the origin root a relative and an absolute path resolve to the same pathname, so this is behavior-preserving there; under a prefix it is the difference between reaching the route and missing it.

**An execution succeeds only on positive evidence of a completed turn.** `nonCompletedTurnEnd` returns the reason kind for anything that is not `completed`, and `unknown` for a payload it cannot read; `inspect` reports `failed` for both, keeping the historical `agent turn ended with an error` wording for the `error` kind. The five bogus fixtures were corrected to `completed`.

**The reuse branch asserts the pinned preset by reading it, never by creating.** The fresh branch asserts the pin through `session/create`'s `agentPreset`. The reuse branch must not call that method — it would create or re-adopt the very session the board only meant to continue, which the package's own rule forbids ("复用时重新应用钉住的 permission/model 再入队 Prompt，不重命名、不新建") and which `tests/host-runner.spec.ts` asserts (`reuse must not call session/...`). Instead `assertReusedPreset` reads the recorded value through `session/projections` — the documented read that resolves no Agent — and fails closed on a mismatch or an unreadable value. `projections` carries its request under the `request` wire key and is registered in the test fake's `wireArgsKeys` table so a drifted wrapper cannot pass silently.

## Testing

`packages/dsh-task-board/tests/host-runner.spec.ts` adds four tests: a reuse run whose session records another preset fails closed naming both presets and never prompts, an unreadable recorded preset rejects the run, an `interrupted` turn reports `failed`, and a malformed `turn/end` reports `failed`. All four fail against the pre-fix source (verified by stashing `src/host-runner.ts`). The client-route change is covered by the per-package suites that assert the posted URL: `dsh-skill-explorer/tests/client-api.spec.ts` and `contract.spec.ts`, `dsh-git-graph/tests/create-worktree-session.spec.ts`, `dsh-task-board/tests/host-api.spec.ts`, `dsh-remote-web-ui/tests/{pair-api,deep-link,remote-entry,update-entry}.spec.*`.

## Alternatives considered

**A shared document-relative URL helper resolved against `document.baseURI`.** Rejected as the primary mechanism. A helper centralizes the rule, but the browser already resolves a relative path against `document.baseURI` for `fetch`, `EventSource`, and `WebSocket` alike, so the helper would add an abstraction whose only job is to reproduce a platform behavior. The literal form also matches the official client verbatim, which is what makes the convention auditable by reading the upstream source.

**Rewriting paths inside the remote channel's fence instead.** The channel's `shouldRewriteFetchPath` matches on `pathname.startsWith('/api/')`, so under a prefix the resolved pathname (`/dsh/dsh/api/...`) no longer matches and a *remote* sub-path page would stop riding the gated channel. This is a real follow-on gap, but it is not the reported deployment: the reporter's page is a local reverse-proxy mount, where the channel is not installed at all (`remoteChannelRequired` returns false for a loopback page), so relative routes reach the proxy directly. Making the fence mount-aware means threading the mount prefix through both the browser patch and the parse-time boot script, changing a security-sensitive gate — out of scope for this batch and left for a dedicated change.

**Reporting only `interrupted` and keeping the old permissive default.** Rejected. The failure the reporter saw is indistinguishable from any other non-completed reason at the board's level, and an unreadable payload is precisely the case where silence is least defensible. Requiring `completed` makes the success path narrow and the failure path loud.

**Calling `session/create` on the reuse path to get the preset assertion for free.** Rejected: it violates the package's no-new-session reuse rule and is asserted against by an existing test.

**Passing `agentPreset` to `session/projections`.** Not applicable: `projections` is a read with no such parameter, which is why the comparison happens in the board.

## Consequences

A prefix-mounted GUI now reaches every plugin route. At the origin root nothing changes observably.

A cron or manual execution that dies before completing is recorded `failed` with a reason-specific message instead of `succeeded`. Existing ledgers keep their historical records; only newly inspected executions are classified this way. A task whose session was composed from a different preset than the card pins now fails closed on the reuse path — a card that previously ran silently under the wrong composition will start reporting a launch failure until the session or the pin is corrected, which is the intended trade.

The remote-pairing fence remains prefix-unaware (see Alternatives). A sub-path deployment reached from a *remote* device is not addressed by this change.

Nothing here requires a DSH service restart for the host half; the client halves ship in the plugin bundles, so a page refresh picks them up once the bundles are rebuilt.