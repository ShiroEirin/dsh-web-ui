# Agent Note: macOS window drag region under family body-level decorations

Status: implemented

## Problem

The official desktop client builds its main window with `titleBarStyle: "hiddenInset"` and no JavaScript double-click handler, so on macOS the window's draggable area is entirely declared by the page: every chrome row marks itself `data-window-drag`, and the official base stylesheet turns that mark into the single `html[data-platform=darwin] [data-window-drag] { -webkit-app-region: drag }` rule. macOS starts a window drag **and** runs the system double-click action ("Double-click a window's title bar to: Zoom") only inside that region, so an empty region costs both interactions.

The same stylesheet declares `html[data-platform=darwin] body>:not(#root) { -webkit-app-region: no-drag }`: every direct body child subtracts from the window's region. `-webkit-app-region` is inherited, so a body-level element also makes its whole subtree subtract, and the region the browser hands to the OS is the union of the drag rectangles minus the union of the no-drag rectangles — order- and paint-independent. A body-level element that spans the viewport therefore removes the *entire* window from the draggable region, official `[data-window-drag]` rows included.

The family's decorations are exactly such elements. The skin center mounts its six fixed decoration layers on `document.body` at controller creation, so they exist with no skin, custom theme or wallpaper active at all, and `background`, `ambient` and `foreground` span the viewport in every state; its backdrop-blur veil is a seventh full-viewport body child whenever the background blur is on; the aggregate's boot splash is a full-viewport body child for the first second of every page load. All of them are declared non-interactive (`aria-hidden`, `pointer-events: none`, "decoration must never eat clicks") — but `pointer-events` does not exempt an element from the app-region computation, only a declaration of its own does, and the official selector (`html[data-platform=darwin] body>:not(#root)`, specificity 1-1-2) outranks anything a plugin writes without `!important`.

Reported symptom: with the plugin family mounted in the desktop profile, double-clicking the window's title area no longer zooms the window to fit the screen on macOS; with the family unmounted it does. Window dragging by the same area is lost by the same mechanism.

## Decision

The aggregate compat layer owns a desktop-only opt-out for non-interactive family body-level overlays.

- `packages/dsh-web-all/src/client/index.ts` (`RESPONSIVE_CSS`) declares `html[data-platform="darwin"] body > :is([data-dsh-skin-layer], [data-dsh-boot-splash], [aria-hidden="true"]) { -webkit-app-region: initial !important; }`.
- `initial` is the property's initial value (`none`), which leaves the matched element — and, through inheritance, everything inside it — out of the app-region computation entirely: it neither drags nor subtracts. `!important` is required because the official selector is more specific.
- The three selectors name the three shapes of a family decoration: the skin center's layers by their contract attribute, the aggregate's own boot splash by its attribute, and any direct body child the page declares non-interactive with `aria-hidden="true"` — which is how the skin center's backdrop-blur veil identifies itself (it carries no plugin attribute).
- The guard is scoped to `html[data-platform="darwin"]` and to direct body children, so no other platform and no app subtree changes behaviour.
- Interactive family overlays stay out of scope: the center-column panels (task board, ssh) are `display: none` unless active, the skill-explorer panel exists only while open, and the official no-drag behaviour of an open modal matches the official settings overlay.

## Alternatives considered

- **Fix only the layer-owning package.** Rejected as the sole fix: desktop installs consume that package from npm (the profile resolves it through the linked aggregate's `rows:`), so a fix there reaches a running install only after a satellite release, and it would not cover the aggregate's own boot splash or any later family decoration. The guard lives in the compat layer for the same reason the [viewport lock](2026-09-23-viewport-lock-for-installs-without-a-visual.md) does: the aggregate must be correct on its own for every install.
- **Neutralize the official body-child rule wholesale** (`html[data-platform=darwin] body > :not(#root) { -webkit-app-region: initial !important }`). Rejected: it also drops the official application's own body-level portals (its settings overlay and onboarding surface) out of the computation and changes window behaviour for surfaces this repository does not own.
- **Re-declare the drag region instead of opting out** (`[data-window-drag] { -webkit-app-region: drag !important }`). Rejected: the region is `union(drag) - union(no-drag)`, so a viewport-sized no-drag overlay cannot be undone from the rows underneath it.
- **Re-parent the decorations out of `document.body`.** Rejected: they are fixed, full-viewport, cross-package surfaces with a documented z-index ladder (background `-2` through foreground `41`); moving them into the app root would change stacking, paint order and every skin's layering contract.
- **Stop creating the layers when no visual is active.** Rejected: they are the skin runtime's stable mount points (component scope, surviving skin switches and client reloads) and the veil belongs to the background feature; gating them on an active visual adds a creation/teardown lifecycle for a problem that is purely about the app-region computation.
- **Scripted runtime marking** (scan body children for viewport-covering boxes and stamp an opt-out attribute). Rejected: it needs a layout read in a hot path that already runs once per mutation batch, and the stylesheet expresses the same outcome without geometry heuristics.

## Consequences

- On macOS the window keeps a draggable region while the family is mounted, so the system double-click action (zoom to fit the screen) and drag-by-title-area work again; the layers' `pointer-events: none` contract is unchanged, because only the app-region computation is touched.
- The match is by DOM shape, not by package: any family decoration that is a direct body child and declares itself non-interactive is covered without touching the stylesheet again. Script and style body children match the selector too and contribute no box.
- An open family modal (skill-explorer) still suspends window dragging over its overlay, matching the official settings overlay; restoring a drag band inside family modals is a separate decision and is not claimed here.
- The guard is a second home for one fact shared with the skin center (its layers are the main subject). The compat layer's copy is the one that must hold for published satellite builds; if the skin center later declares the same opt-out on its own nodes, this note still owns the aggregate-side fact and the mirror stays justified by installs whose satellite predates it.
- Verified evidence: on a local `dsh web` host serving the linked aggregate (Playwright, `data-platform="darwin"` applied after boot), the four viewport-spanning body children measured `-webkit-app-region: no-drag` before the change and `none` after it, while the three official `[data-window-drag]` rows measured `drag` both times. The native double-click action itself was not synthesized; the claim is verified at the computed-style/region-input level.
- The change is client-side only. The host serves the rebuilt bundle from the linked package without a restart (measured), so a page reload picks it up; a desktop install whose renderer has no reload applies it on the next application start.

## Testing

- `packages/dsh-web-all/tests/responsive-contract.spec.ts` gains a case that asserts the guard's shape — the `html[data-platform="darwin"] body > :is(...)` scope, the three markers, and `-webkit-app-region: initial !important` — and that the guard appears once; `pnpm --filter @linxin666/dsh-web-all test` runs 12 tests in that file green.
- Live probe against a running `dsh web` host on the linked aggregate with the desktop profile's plugin set active: the served `style[data-dsh-compat="responsive"]` carries the guard; with `data-platform="darwin"` set after boot the skin center's six layers and its backdrop-blur veil compute `-webkit-app-region: none`, and the three official `[data-window-drag]` rows compute `drag`. The same probe before the rebuild measured `no-drag` on the same layers with the same selector.
- `pnpm libs:check` passes against the rebuilt `packages/dsh-web-all/lib/client.js` and the refreshed `scripts/lib-artifact-fingerprints.json`.
