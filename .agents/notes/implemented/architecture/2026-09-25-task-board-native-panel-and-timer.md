# Agent Note: task-board renders in the native layout panel and arms the native timer

Status: implemented

## Problem

The task board was the family's only feature surface still implemented as a DOM takeover. `board-mount.tsx` appended a container inside the center column (`[class*='centerCol']`, falling back to `[data-pane='conversation']`), hid the conversation subtree with an `html[data-dsh-taskboard-active]` rule, and self-healed the container through a `document.body` MutationObserver; a parallel `sidebar-entry-core.ts` copy injected the sidebar row and hand-drew its box. Every piece of shell chrome had to be re-derived by hand — row geometry, the 56px collapsed rail, the active highlight, the label, the locale refresh — and each shell refactor risked breaking the takeover. The desktop application's own 插件 page needs none of that: it is an official panel.

Separately, the scheduler woke on a fixed 30-second heartbeat, so a cron minute could fire up to 30 seconds late and every wake-up ran whether or not a target was due.

## Decision

- **The board contributes the shell's own panel seats.** `src/client/native-panel.tsx` registers a `sidebar.panellist` row (list seat: `id`/`order`/`label`) and a keyed `main` page (`key: TASK_BOARD_PANEL_ID`), both through `ctx.slots.inject`, which fires only after the owning shell entry declares the seat — so load order between the board, ui-layout, and ui-sidebar never matters and a shell that cannot serve a seat leaves the board absent instead of failing boot. The row supplies only a glyph component and takes the shell's requested edge through `size`; the shell owns the button, the label, the tooltip, the active highlight, and the rail.
- **Panel selection is the layout's, and the controller follows it.** `BoardController` gained an optional `panel` face; `openBoard()`/`closeBoard()` flip the snapshot and then call `ctx.layout.selectPanel` (`TASK_BOARD_PANEL_ID` / `null`), and `syncPanelSelection` reconciles a selection made outside the controller (clicking another row, or the layout dropping the panel id) back into `boardOpen`. The face is optional so the controller stays testable without a shell, and a throwing `selectPanel` (the layout's documented pre-mount behavior) is swallowed after the state flip.
- **The DOM takeover is retired from this package.** `board-mount.tsx`, `sidebar-entry.ts`, the local `panel-mount-core.ts`/`sidebar-entry-core.ts`/`body-mutations.ts` copies, and the takeover CSS (the `html[data-dsh-taskboard-active]` visibility contract, the `.entry` row geometry and collapsed-rail rules) are gone. `[data-dsh-taskboard-view]` stays on the page root as the L2 semantic anchor and now declares the container-query context, so the board's responsive rules still measure its panel rather than the viewport. `sidebar-entry-core.ts`/`panel-mount-core.ts` remain shared with dsh-ssh (skill-explorer for the former), each with one fewer consumer.
- **Cross-plugin exclusivity was explicit while the takeover lasted.** ssh (and, for a time, the skill center) still took the column over at the DOM level, so the board participated in the shared `dsh-panel-activate` protocol to hand the column back and forth. That protocol, its `PANEL_FAMILY` table and the `panel-mount-core` core have since been removed along with the takeover itself: ssh and the skill center register the same native seats this note describes, so the layout alone decides which page renders ([One center-column panel family](2026-09-23-center-column-panel-family.md)).

## Testing

- `packages/dsh-task-board`: 49 files / 562 tests (561 passed, 1 skipped), the same shape as the pre-change baseline.
- Native panel: `board-view.spec.tsx` now renders the page and asserts the `data-dsh-taskboard-view`/`data-dsh-plugin` anchor and the container-query context; `sidebar-entry-layout.spec.ts` pins the seat names, the glyph contract, the shell-owned label, and the absence of the takeover CSS; `client-apply-teardown.spec.ts` asserts both registrations land in the official seats and are released with the fiber (no zombie row after an in-place bundle replacement).
- Panel navigation: `controller.spec.ts` covers the open/close selection sequence, the redundant-open no-op, a throwing layout face, and following an outside switch without writing back.
- Coexistence: `panel-coexistence.spec.ts` covers both directions of the ssh protocol, ignoring foreign/self announcements, and a disposed fiber leaving the protocol.
- Native timer: `host-service.spec.ts` and `handover-confirm.spec.ts` drive a controllable `HostTimerFace` and assert the armed instant, the archived-skip, the missed-occurrence recovery path, the single recurring timer, and `start()` idempotence.
- Gates: `pnpm typecheck` (whole workspace), the package suite, `sync-shared --check`, `inject-contract`, and `aggregate --check` pass; `@deepseek-ai/dsh-client-ui-layout` joins `APPROVED_INJECT_MODULES` (it is the ui-layout row and owns the `main` seat plus `ctx.layout`), and the sync-shared copy buckets move to 98 total / 38 client.

## Alternatives considered

- Keep the DOM takeover and only restyle it to look like the official panel: rejected — the takeover is what forces the hand-drawn row geometry, the observer, and the hide-the-conversation rule; matching the look leaves the mechanism and its failure modes intact.
- Register only `main` and keep the hand-injected sidebar row: rejected — the row is where most of the duplicated shell chrome lives (`.entry` geometry, the collapsed rail, the active attribute), and a hand-drawn row beside official `sidebar.panellist` rows drifts apart from them.
- Have the board keep its own `html[data-dsh-taskboard-active]` attribute so ssh's existing guard keeps working: rejected — it would preserve exactly the interception this change removes, and the board would still need the hidden-conversation CSS that motivated the migration.
- Migrate the board to the native `schedule` service/UI as well: rejected — that service schedules host-side agent runs, not task-board executions bound to its own ledger, permission gates, and run groups; the board adopts the native **timer** (the primitive the requirement names) while keeping its scheduler semantics.
- Poll the ledger on a shorter interval instead of arming a one-shot: rejected — it trades a wrong wake-up time for constant wake-ups and still cannot fire exactly at the target.

## Consequences

- The board's row and page are the shell's own; a future shell restyle reaches them without a companion change here, and the collapsed rail and active state come for free.
- `[data-dsh-taskboard-entry]` no longer exists, and `html[data-dsh-taskboard-active]` no longer gates visibility. The takeover cores ssh shared with the board (`panel-mount-core.ts`, `sidebar-entry-core.ts`) are gone as well, so no synced copy still carries the inert `siblingActiveAttribute`. The dsh-skins repository re-anchored its row hooks in the follow-up commit (`a342b8e` on its `main`); the mechanism lives in the [family note](2026-09-23-center-column-panel-family.md).
- The board depends on the layout being present to show a page: a deployment without the `ui-layout` row keeps the board's host/agent surface but has no panel to render it in.
- Scheduled runs fire at the armed instant instead of up to 30 seconds late, and a host that slept or resumed skips missed occurrences rather than replaying them (unchanged semantics, now enforced by the tolerance window).
