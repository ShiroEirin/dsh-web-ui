# Agent Note: Task-board Host failure diagnostics and stale-lock recovery

Status: implemented

## Problem

Issue #1528 reported a board whose Host half had never mounted: the panel showed `Host 操作失败：Unexpected token 'o', "not found" is not valid JSON`, the task list stayed empty forever, and the on-disk evidence was a 0-byte `ledger-v2.lock` whose mtime was two days old while the running Host had started later.

Two defects produced that. The browser transport parsed every response as JSON, so the core webserver's plain-text `not found` for an unmounted `/api` path became the user-visible error. And `HostTaskLedger.acquireLock` treated an unreadable lock as fatal, so a leftover from an unclean shutdown stopped the whole Host half from mounting until a human deleted the file.

## Decision

The browser transport classifies Host failures (`not-mounted`, `ledger-locked`, `degraded`, `unauthorized`, `forbidden`, `locked`, `rejected`, `timeout`, `unreachable`, `unexpected`) and renders each as its own sentence in the active language; a non-JSON body is never handed to `JSON.parse`. A failed event stream nudges the panel into one state read, throttled to one per 15 s, so a Host half that never mounted is visible instead of silently empty.

`HostTaskLedger` reclaims an unreadable lock once its mtime is older than `UNREADABLE_LOCK_GRACE_MS` (60 s). The owner writes and fsyncs its record immediately after `O_EXCL`, so an unreadable lock that old cannot be mid-write. A fresh unreadable lock still fails closed with the recovery hint, and a lock held by a live process is still refused.

A bare 404 from the board's own routes is the ONLY signal that they are absent. Before rendering it, the transport reads the family health route `api/dsh-web-all/degraded` (document-relative, issue #1707) and looks up its own row by package name: when that row degraded during start, the shell's recorded reason replaces the generic wording — `ledger-locked` with the owning pid when the reason names a live owner, `degraded` with the reason verbatim otherwise. The lookup is best-effort: a missing, refusing, unreadable or unknown-shaped answer keeps `not-mounted`.

The shell's degraded record gained a bounded one-line `reason` beside the full `message` (stack), and `GET /api/dsh-web-all/degraded` serves it — additively, so a reader that predates the field keeps using stage/message. That route is loopback-only; the family `/api/dsh-web-all/rows` row ledger keeps listing a row whose plugin degraded, because the row IS active and its UI entry must survive the failure (the degraded ledger is the signal that explains it).

## Alternatives considered

Showing the raw parse error with a link to a troubleshooting page was rejected: the panel is the only surface the reporter had, and a JavaScript runtime error carries no information about which failure occurred.

Always reclaiming an unreadable lock was rejected: between `openSync(..., 'wx')` and the owner's `writeFileSync` the file is legitimately empty, and reclaiming it there would start a second ledger writer over the same document.

Registering the board's own routes behind a Host service that can be constructed without a ledger (and answering 503 with the constructor's failure reason) stays deferred, not rejected: it is the other way to report "another live DSH instance holds the ledger" precisely, and it would cost the board a second lifecycle state in which no ledger exists. Reading the family health ledger needs none of that, because the shell already records the reason.

Keeping `not-mounted` for every absent route and improving only its wording was rejected: it cannot name the owner, and it keeps advising a restart that provably cannot win a lock another process holds.

## Consequences

Failure text moved into the task-board dictionary and its Russian mirror in `dsh-i18n`. The panel now distinguishes an unmounted API from a rejected action from a ledger another process owns, which is what triage needs.

The precise reason a degraded family row failed is now readable by any surface that can reach the loopback-only family health route, instead of living only in the Host log.
