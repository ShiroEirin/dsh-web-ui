# Agent Note: One center-column panel family, rendered through the native layout seats

Status: implemented

## Problem

The `conversation` slot is single-occupant, and external plugins cannot declare
slots there, so the family's feature surfaces (dsh-ssh, the task board, the
skill center) each took the center column over at the DOM level: a container
appended inside the column, an `<html>` activation attribute, and a stylesheet
that hid the conversation underneath. Every piece of shell chrome — row
geometry, the collapsed rail, the active highlight, the label, the locale
refresh — had to be re-derived by hand, and each shell refactor risked breaking
it.

The takeover also duplicated itself. dsh-ssh `mount.tsx` and dsh-task-board
`board-mount.tsx` each carried the whole lifecycle, ~100 of ~130 lines
identical modulo seven parameters, and the same behavioral fix landed twice as
separate issues and commits: the rc.6 `centerCol` fallback (#243 / #107),
mutual exclusion and sidebar click-out (c0a98c715), locale routing (170b3df31),
and the L2 semantic attributes (d73bffc2a). Occupancy was then expressed
pairwise (each panel named one sibling), which cannot express three panels: a
panel that did not name the third stayed logically open while invisible, so its
sidebar row needed a second click to reopen.

## Decision

**Every family panel renders through the shell's own seats.** A panel registers
a row into `sidebar.panellist` and a keyed page into the layout's `main` slot
through `ctx.slots.inject`, and drives `ctx.layout.selectPanel` (the layout's
`panelInfo` is reconciled back into the panel's controller). The shell owns the
row box, label, tooltip, active highlight, collapsed rail, the panel switch and
the window-chrome interplay, exactly as it does for the shipped Plugins and
Schedule pages.

**The layout's keyed `main` slot is the single occupancy authority.** The
`PANEL_FAMILY` table, the `dsh-panel-activate` event and the shared
`shared/client/panel-mount-core.ts` / `shared/client/sidebar-entry-core.ts`
cores are deleted, along with every synced copy and the takeover wrappers
(`mount.tsx`, `sidebar-entry.ts`, the package-local core copies). Occupancy is
no longer something the family negotiates: the shell renders the selected key
and unmounts the rest.

Two preconditions came out of the migration, and both are now part of the
pattern:

1. **A panel's view state lives in its controller, never in the page
   component.** The layout mounts a keyed page only while its panel is
   selected. Component-local state therefore dropped the open tab and any
   in-progress edit on every panel switch. The task board's state was already
   controller-owned; the skill center's tab and editor target, and ssh's active
   tab, connect request and terminal session id, moved into theirs.
2. **A long-lived resource is never owned by the view.** The ssh terminal's PTY
   shell moved to the host (`src/engine/terminal-sessions.ts`): a session is
   created once, any socket attaches by id, and a view unmount only detaches.
   The takeover used to provide this by keeping every visited tree mounted, so
   losing it would have killed a live shell session on every panel switch.

## Testing

- `native-panel-registry.spec.ts` in each of dsh-task-board, dsh-skill-explorer
  and dsh-ssh drives the real `SlotCore` the shell installs, asserting the
  keyed `main` entry, the list row (id, order, function label) and that
  disposal clears both.
- The controller-state specs (`panel-state.spec.ts` for the skill center, the
  ssh panel suite) pin that the open tab, the editor target and the terminal
  session id survive a panel switch and that a snapshot stays referentially
  stable between changes.
- `packages/dsh-ssh/tests/terminal-sessions.test.ts` drives the host session
  table directly: detach/reattach with scrollback replay, explicit close, idle
  reap, and the exit grace window.
- The panel component suites cover the pages' own rendering and semantic
  attributes.

## Alternatives considered

- **Keep the DOM takeover** (and the shared core it needed): rejected — it
  re-derives shell chrome that the shell already owns, and the family had
  already paid for the duplication twice over.
- **Pairwise siblings extended to three** (every panel names the other two):
  N² configuration, and each new panel must edit the other panels' mounts; the
  failure mode is a stale pairing, not a missing table row.
- **Self-contained takeover inside each panel**, closing the others by
  broadcasting their names: zero cross-package edits, but the mechanism becomes
  a per-panel hack and the next panel pays the same cost again.
- **Extract the takeover into a runtime npm package** imported by the family:
  rejected — client bundles must stay self-contained per the browser bundle
  purity rules; the sync-shared committed-copy pattern was the repo's
  established mechanism, and the migration removed the need for it entirely.
- **Keep the view native but hold the terminal in a persistent off-screen
  container**: smaller than moving the session to the host, but it retains the
  very DOM lifecycle the migration exists to retire, survives neither a reload
  nor a dropped socket, and would coexist with the seats it is meant to replace.
- **Keep the skill center's overlay modal and restyle only**: cheapest, but the
  panel would not be reachable or dismissable like the rest of the family,
  which is what its migration was for.

## Consequences

- Adding a family panel is one `sidebar.panellist` registration plus one keyed
  `main` registration; occupancy, the row box and the rail come for free, and
  there is no family table to keep in step.
- A panel that owns live resources must give them a lifetime longer than its
  page. The host-side session registry is the reference implementation.
- The skins' injected-row hooks were re-anchored in the dsh-skins repository
  (commit `a342b8e` on its `main`): those rows are the shell's now. The retired
  `[data-dsh-*-entry]` row attributes are gone; in their place the contract
  re-defines the `sidebar-entry` part as *the plugin-registered panel row*, and
  skin-center's compat adapter stamps that part on the shell's
  `sidebar.panellist` rows, which it recognises through the css-module row class
  plus the glyph identity the registering plugin itself outputs
  (`data-dsh-panel-entry`). Every shipped skin keyed on the part therefore keeps
  working, and the panel anchors (`data-dsh-ssh-view`,
  `data-dsh-skill-explorer-view`, `data-dsh-taskboard-view`) plus the
  `data-dsh-plugin` markers stay on the page wrappers, so panel-level skin rules
  keep working too.
- dsh-ssh is now the only package that keeps a DOM-level extension path at all
  (`body-mutations` is still shared with the aggregate shell and the usage
  card); it exists for surfaces outside the family, not for panel occupancy.
