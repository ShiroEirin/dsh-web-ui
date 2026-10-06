# Agent Note: Remove two dead shared-artifact paths and realign their facts

Status: implemented

## Problem

A repository-wide optimization pass found two shared artifacts that had outlived their consumers while still being maintained as if live.

The first is `shared/host/run-guarded.ts`. Its sync manifest entry still declared three consumer copies — `packages/dsh-usage`, `packages/dsh-task-board` and `packages/dsh-git-graph` — and the copies were byte-identical to the source. No package in this repository imports the module: a repository-wide search for `run-guarded`, `runGuarded` and `guardedHandler` across tracked sources returns only the shared source, its spec, the manifest, the manifest's test and the three copies themselves. The copy was therefore pure upkeep — every edit to the shared source propagated into three files that no TypeScript program, test project or bundle reads, and `test:scripts` verified them in perpetuity. The satellite repositories do consume the module (`dsh-presets` imports `guardedHandler` from its own copy) and carry their own copies; they are unaffected by what this repository syncs.

The second is `mobileBundle` in `shared/tsdown.client.ts`. It built the standalone mobile page bundle, and the reason it went unused is recorded in prose in `packages/dsh-remote-web-ui/tsdown.prepare.config.ts`: the standalone mobile bundle was removed in 0.4.0 when the official UI became adapted in place. The function had no call site in this repository or in any satellite. It also carried the only `createRequire` use in the preset, so deleting it removed that import as well.

Both artifacts were also described inaccurately by the notes that own their decisions. [The aggregate plugin fault-isolation shell](2026-09-01-aggregate-plugin-fault-isolation-shell.md) stated that `shared/host/run-guarded.ts` is "synced to the four packages with in-process HTTP/poll faces" and that the runGuarded discipline is "synced by `scripts/sync-shared.mjs`". Neither was true of this repository.

## Decision

Both dead paths are gone, and the facts that described them now match what ships.

- `shared/host/run-guarded.ts` and `shared/tests/run-guarded.spec.ts` stay: the module is a shared source with a passing spec, and satellite repositories build their own copies from the same shape. What was removed is this repository's sync entry — the three declared targets and the three generated copies under `packages/dsh-usage/src/host/`, `packages/dsh-task-board/src/host/` and `packages/dsh-git-graph/src/host/`.
- `mobileBundle` and its `node:module` `createRequire` import are deleted from `shared/tsdown.client.ts`. The removal is the completion of a decision already recorded in `tsdown.prepare.config.ts` (the standalone mobile bundle is gone since 0.4.0), not a new direction.
- The sync manifest's composition guard in `scripts/sync-shared.test.mjs` was updated from 99 total copies and 48 host copies to 96 and 45, and its comment now records why `run-guarded.ts` is not synced here so a future reader does not re-add it. The bucket that counts `/src/client/` copies is unchanged at 39, which is the check that the removal touched only the host side.
- [The aggregate plugin fault-isolation shell](2026-09-01-aggregate-plugin-fault-isolation-shell.md) was corrected in both languages: the parenthetical "synced to the four packages with in-process HTTP/poll faces" is gone, and the closing sentence now states that the discipline is opt-in and that no package in this repository adopts it today, so the shared source and its spec remain without generated copies here. Its decision, alternatives and consequences are untouched.

The changes are behavior-preserving by construction: no runtime code imported either artifact, and `lib/` output is byte-identical after the change — only the recorded source fingerprint in `scripts/lib-artifact-fingerprints.json` moved, because the shared preset's sources changed.

## Alternatives considered

**Keep the three copies and mark the manifest entry as intentional.** Rejected: the copies have no reader, and the entry's own comment ("routed HTTP handlers of every package with an in-process HTTP face adopt it; more packages adopt incrementally") describes an adoption that did not happen. Leaving the entry keeps a generator obligation alive for a consumer that does not exist.

**Delete `shared/host/run-guarded.ts` as well, since nothing here imports it.** Rejected: it is shared source with a passing spec, and the satellites consume the same contract from their own copies. Deleting the source would remove the canonical definition this repository publishes to its satellites while leaving their copies in place.

**Consolidate the identical `isRecord` and `messageOf` helpers found by the same pass.** Deferred, not rejected: `shared/` has no generic client-side destination module today, so consolidation needs a new manifest target and its own gate. Recorded as a follow-up rather than folded into a deletion change.

## Consequences

The manifest no longer maintains files nobody reads, and the sync gate's copy count is 96. The cost is that a future in-repo consumer of `runGuarded` must add a manifest entry rather than finding a copy already generated — which is the correct signal, and the updated test comment says so. Satellite repositories still sync their own copies on their own schedule.