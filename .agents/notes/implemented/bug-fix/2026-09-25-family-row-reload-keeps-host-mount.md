# Agent Note: A reloaded family row keeps its Host mount

Status: implemented

## Problem

One aggregate row per family plugin mounts a real plugin package behind the
[aggregate shell](2026-09-01-aggregate-plugin-fault-isolation-shell.md), and
the shared `mountOnce` guard (`shared/host/mount-once.ts`) exists so the
aggregate row and a standalone install of the same package can coexist in one
process: the first mount runs, a later mount of the same package name is a
no-op, and the name is released when the holder's fiber disposes.

A dropped mount is only benign while the holder stays alive. The Host composes
a reload by creating the new loader entries before the previous ones are torn
down - the profile reload the plugin manager triggers on every
enable/disable/install write, an HMR reload of `cordis.patch.yml`, and a
settings-driven row remount all land in that ordering. The reloaded shell
entry then requests the same package name while the previous entry still holds
it, so its mount was dropped; when the previous entry disposed its own mount a
moment later, the name was free with nobody left to take it. The family row
stayed listed as active in the row ledger, recorded no degraded entry (nothing
threw, so the shell's isolation ledger had no failure to report), and served no
Host routes: on the dsh-app desktop the task board answered `/api/task-board/*`
with the webserver's plain `not found`, the panel rendered
`board.hostError.notMounted` over an empty board, and only a Host restart
recovered it. The ledger's 30 s scheduler heartbeat stopped at the same instant
the reload happened, which is what pinned the loss to the reload rather than to
a mount failure.

## Decision

`mountOnce` keeps its single-instance guarantee and never drops a refused
mount:

- A mount refused while another fiber owns the package name is queued on that
  holder together with its own context and config, and replayed when the holder
  releases the name. The replay runs one microtask after the release, so the
  disposing mount's own effects (webserver routes, ledger, timers) are torn down
  before the next one registers. The replay re-enters the guard, so a mount that
  arrives in between still dedupes to exactly one live instance.
- A waiter whose own fiber disposes before the release is removed from the queue
  and never replayed: its context is gone and registering effects on it would
  throw.
- The name is still released by the holder's own disposer (the fiber-scoped
  effect the guard registers), and the released name is handed to the queue in
  arrival order.

The guard's ownership rule is unchanged: exactly one mount is live per package
name, and the aggregate row plus a standalone install still never double-register
routes, tools, settings namespaces, or system-prompt sections.

## Cross-repository registry contract

`Symbol.for('dsh-web.mounted-plugins')` is a contract shared with builds this
repository does not compile: the four satellite packages (dsh-skins, dsh-pet,
dsh-presets, dsh-community-plugins) are separate repositories that carry their
own copy of this guard and are rebuilt on their own schedule. The value stored
under that key therefore keeps the shape every published copy reads - a `Set`
of package names with `has`/`add`/`delete` - and the wait queues this guard
added live under their own additive key,
`Symbol.for('dsh-web.mounted-plugins.waiters')`, as a
`Map<string, PendingMount[]>`. A foreign value found under the shared key
(an interim shape, a hand-written global) is replaced with a fresh `Set`
instead of being read as one.

The first cut of this fix stored the claim map under the shared key itself. That
shape change is the mistake this section exists to prevent: every satellite
still wrote a `Set`, so in a process where a satellite mounted first the family
copies read a `Set` as a `Map`, and each row mounted after that point degraded
with "claims.get is not a function" - observed live as the model-capabilities and
remote-web-ui rows failing while their routes disappeared, which is worse than
the defect being fixed. The additive key keeps the replay behavior and the
cross-repository contract independent of each other.

## Testing

`shared/tests/mount-once.spec.ts` pins the replay, the abandoned-waiter path,
the one-live-mount rule for several waiters racing one release, and the
unchanged independent-package behavior. `packages/dsh-web-all/tests/shell-reload-mount.spec.ts`
drives the real shell source with a real cordis context over a family-row
stand-in: it mounts the row, mounts the reloaded entry while the previous entry
is still alive, disposes the previous entry, and asserts the row still serves
its route and that the last entry's disposal still tears it down. That test fails
against the previous implementation (`expected false to be true` on the
post-disposal route assertion), which is the regression this note records. Two
more shared cases pin the cross-repository contract: a `Set` left under the
shared key by an older copy is honored rather than read as a map, and a foreign
value under that key is repaired instead of taking every later mount down.

## Alternatives considered

Retrying inside the aggregate shell was rejected: the shell cannot see another
entry's mount, and thirteen packages share the guard, so the contract belongs
where the package name is owned. Removing `mountOnce` was rejected: the
aggregate row and a standalone install of the same package would double-register
routes, tools and settings and fail the boot, which is why the guard exists.
Releasing the name at the start of the holder's disposal was rejected: the
release has to follow that mount's own route and ledger disposal or the two
mounts overlap for an instant, and the queue makes the exact ordering
irrelevant. A synchronous handover inside the disposer was rejected for the same
reason - replaying mid-teardown can register new routes while the previous ones
still exist, which is the duplicate-route failure the aggregate already hit
once.

## Consequences

A family plugin that is reloaded while its previous entry still lives now keeps
serving: the Host no longer needs a restart to bring the task board, the market,
the git graph, and the other family host halves back after a profile write. The
replay registers the plugin's effects after the reloaded entry's `apply`
resolved, which the shell's own bookkeeping already tolerates (the delayed
effects belong to the same fiber and dispose with it), and the routing decisions
in `packages/dsh-web-all/src/shell.ts` need no change. A process that keeps two
sources of one package alive for its whole lifetime retains the refused mount as
a queued waiter (a closure per row) instead of discarding it; that is the price
of never losing a mount.

The satellite packages keep working against the new guard without a rebuild:
the shared key they read keeps its shape, and only the new copies read the added
queue key. A name held by a copy built before this change is still never
double-mounted, but that holder's release does not drain the new queue, so a
mount refused only by a pre-change holder stays queued until that name is taken
again - a combination that disappears once the holder's package is rebuilt.
