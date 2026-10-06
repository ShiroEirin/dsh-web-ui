# Agent Note: handover bundle + manual permission confirmation gate (issue #5)

Status: implemented

## Problem

ADR 0001's second capability: a continuation card must be able to carry a handover bundle (pinned triplet + doc/script references), and an effective permission above the session default must never execute unattended — closing adversarial scenario b (a low-privilege card creator getting a high-privilege card to run, manually or through cron).

## Decision

- `TaskRecord` gained `handover?: TaskHandover` (workspaceId/mode/permission + bounded `references`, stamped `bundledAt`) and `permissionConfirmedAt?: number`. `core/handover.ts` owns the domain: `sanitizeHandover` (exact keys, string targets, known permission, 32 refs / 512 B each / 8 KiB total), `effectivePermission` (bundle overrides the plain pin), `requiresPermissionConfirmation` (elevated AND unconfirmed), and the `PERMISSION_RANK` elevation order against `DEFAULT_SESSION_PERMISSION = 'read-only'`.
- `protocol.ts` accepts `handover` on create inputs and update patches (null clears, mirroring freeze) and adds the `confirm-permission` action; the sanitized bundle replaces the wire value in place. The import whitelist passes handover through `parseLedger` normalization but strips `permissionConfirmedAt` — import is not a human confirmation action, so an elevated binding re-arms the gate (review hardening, see `2026-08-24-review-hardening.md`).
- The Host ledger refuses `run`/`rerun` with `confirmation-required` for an unconfirmed elevated card; `openScheduled` (cron) skips the card and rolls `nextRunAt` forward like the already-running refusal; the new `confirm-permission` case stamps `permissionConfirmedAt`. The comparison baseline is the ledger's `sessionDefaultPermission` option, surfaced in every snapshot for UI-side gating: the plugin config key when a deployment pins one, otherwise the Host's own default permission preset — the value new sessions start at, read live from the official `permissionPresets` service through `TaskBoardHostService` — with the fail-safe `DEFAULT_SESSION_PERMISSION = 'read-only'` covering a deployment whose catalog cannot be read.
- Re-arm semantics: the confirmation binds the exact permission value. `applyUpdateTask` clears `permissionConfirmedAt` on a real permission change or any handover change (including clear) — confirm-then-swap cannot carry an old confirmation onto a new higher permission.
- `HostExecutionRunner.launch` resolves the effective triplet (bundle over pin) before validation, and prepends a handover preamble (references + bundle timestamp) to the prompt when a bundle carries references.
- UI: the new-task modal gains a references textarea (filled lines attach the picked triplet as a bundle); the task detail shows the bundle section (triplet + references + bundledAt), a pending-confirmation banner with a confirm button (`controller.confirmPermission`), and the confirmed stamp. Store normalization drops a malformed bundle or stamp alone, never the task row.

## Alternatives considered

- A separate pending-approval queue modeled on the remote-web-ui approval events — rejected for this ticket: the Host ledger transaction model already gives idempotent, durable state; a stamp on the task row is the same "pending transaction" resolved by an explicit human action, with one source of truth.
- Blocking high-permission cards at write time — rejected: the requirement is confirm-then-execute, not deny; creation must stay possible (the bundle is exactly how work is handed to a more privileged operator).
- Reading the session default from the runtime API — deferred when the gate shipped, since no SDK face exposed it then: the config key kept the gate conservative (read-only default means any write elevation asked once). The official `permissionPresets` service publishes that value now, so an unset config key follows the Host default and the conservative default survives only as the fallback for a deployment that serves no catalog.

## Consequences

- The cron refusal reuses the roll-forward path, so an unconfirmed scheduled card keeps its schedule armed but never fires until confirmed — no execution, no queue.
- `sessionDefaultPermission` is a deployment-declared override; a deployment that sets it above its real session default weakens the gate for the gap (documented in the README configuration table). Left unset the baseline is the Host's own default preset re-read at every gate evaluation, so the gap exists only while an operator pins a wider value than the Host serves.
- The in-session freeze generation entry (agents producing `<<<FREEZE` blocks) remains open; bundles are attached through the UI/protocol today.

## Verification

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` pass (274 tests; new `tests/handover-confirm.spec.ts` covers the protocol gate, use-case stamp/re-arm, store normalization, unconfirmed run refusal, confirm-then-run, at-default run, cron refusal + roll-forward, post-confirm cron launch, and runner override/preamble; `tests/handover-ui.spec.tsx` covers the detail-view banner, confirm button, and confirmed stamp; the baseline added later is covered by the `host permission baseline` cases in `tests/host-apply.spec.ts`, which mount the real Host half: follow the Host default, honour an explicit pin, fall back when no catalog is served, and follow a default lowered while the board runs). `pnpm docs:check` passes after the README pair update.
