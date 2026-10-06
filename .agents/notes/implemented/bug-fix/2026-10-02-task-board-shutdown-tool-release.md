# Agent Note: Board teardown releases the tool surface instead of rebinding it

Status: implemented

## Problem

A clean shutdown of `dsh web` on Windows printed one error line per model-visible tool every Task Board provider exposes: seven `registration failed ... cannot create effect on inactive context` lines for the GitHub extension alone. The count scaled with the tool surface, so it repeated on every graceful exit and never appeared on a forced kill.

cordis marks a fiber UNLOADING before it runs that fiber's disposers, and `Fiber.effect` refuses any effect created on an unloading fiber. The board's mount effect cleanup called `setToolsEnabled(false)`, whose first line rebound the extension tool registry; `setToolRegistry` disposes and re-registers every buffered provider tool, so each of those registrations became a request the host could only refuse. The registry caught the refusal and logged it as an error, which is why the process still exited cleanly: the fault was a redundant re-registration, not a broken teardown.

The two facts the bug turned on are independent. A provider's `active` flag is the board x extension gate, not the host's lifecycle state, so a provider stays `active` while its fiber unloads; and the same `setToolsEnabled` served both a live settings edit and the teardown, so a call that is right in one and wrong in the other served both.

## Decision

The teardown path releases and nothing else; re-registration is reserved for the live path.

- `setToolsEnabled(false)` in `src/index.ts` no longer calls `setToolRegistry`. It disposes the board's own tool handles and returns. A live enable still rebinds the registry first, so the late-resolving and provider-replacement paths (scoped `inject` on `tools`, a `loader/volatile-update` commit) are unchanged.
- `TaskBoardExtensionRegistry.syncTools` treats a refusal carrying the cordis `INACTIVE_EFFECT` code as the host going away: it drops the pending disposer and reports nothing. A tool that cannot be registered during teardown needs no diagnosis, because the teardown releases it moments later. Every other refusal still logs at error level.
- `isInactiveContext` reads the documented error code rather than importing cordis, so the board keeps no runtime dependency on the host framework, and the guard survives a host that renames the message.

Both layers are needed. The `index.ts` change removes the redundant work the bug reported, and the registry guard keeps a board that is asked to rebind late — by a provider fiber reloading during shutdown, for instance — from printing a refusal that no operator can act on.

## Alternatives considered

**Only the log-level downgrade (issue option 3: demote `INACTIVE_EFFECT` to debug).** Rejected because it treats the symptom. The teardown still issued one futile registration per tool, each one entering cordis' effect machinery, and any future caller of that path inherits the noise. It also cannot distinguish "the host is unloading" from "the definition is broken", which the code-level split can.

**Only a fiber-liveness check in `setToolRegistry` / `syncTools` (issue option 2: skip when the fiber is not active).** Rejected because the registry does not hold a fiber: the board resolves an optional `tools` service by name and must keep mounting on a deployment that serves none, and the resolvable service is not the context the registration is created on. Reading a fiber out of the context would couple the registry to a host it deliberately does not depend on, and the check would be wrong for a proxy that serves a live registry from a disposed scope.

**Moving the rebind into the `active` branch only (issue option 1), with no registry guard.** Rejected as a partial fix. It removes the redundant registration this report names, but leaves `syncTools` able to log an error for a refusal that is a normal consequence of shutdown. The two changes are one decision: the teardown registers nothing, and a registration that still arrives during teardown is not an error.

**Suppressing the report at the logger seat the host hands the board.** Rejected because the logger is shared by every failure the registry reports. Filtering there would have to re-parse the error to recover the distinction `syncTools` already has in hand at the point of refusal.

## Consequences

A graceful `dsh web` shutdown releases the board's and its providers' tool surfaces and prints no registration failure, matching what a forced kill already produced. A provider that is refused for a real reason (a reserved or duplicate tool name) still reports at error level. Two test files pin both halves: `tests/host-shutdown-tools.spec.ts` drives the teardown through a context double and the registry's logging split, while `tests/host-shutdown-fiber.spec.ts` runs the same scenario on a real cordis fiber whose `Fiber.effect` raises the refusal itself — three provider tools reproduce three error lines against the unfixed source (seven, for the GitHub extension, whose tool count is seven) and none against the fixed one. Because the guard keys on the error code rather than the message, a host that stops using `INACTIVE_EFFECT` would restore the old noise rather than silently hide a real refusal; the code is cordis' documented stable error code, and the test double carries it explicitly.
