# Agent Note: Mobile compact picker buttons removed from the remote composer

Status: implemented

Partially supersedes [Mobile compact model picker, conversation clipping fix, overlay suppression, verified whale toggle](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md): its Decision 3 — the two synthesized icon buttons in the composer tools row — is removed here. The other three fixes in that note (the omitted `_body` gap rule, the bottom-sheet picker menu, the scoped workbench suppression, the verified whale toggle) are unaffected and still shipped.

## Problem

The portrait adaptation injected two synthesized icon buttons into the official composer tools row — a cube opening the model list and level bars opening the effort list. They were not official controls: the layer created them with `document.createElement('button')`, appended them to `[class$="_composerSeat"] [class$="_tools"]`, hid the official model/effort text trigger behind a body class (`dsh-remote-compact-picker`), and collapsed the official trailing line to zero width so the context ring and send button re-anchored to the row. That was the design recorded in [the v79 note](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md). On a phone these two buttons are extra controls the user never asked to keep, and they push the official trigger off the row.

## Decision

The two synthesized buttons, their drill-through behaviour, the gate body class, the zero-width trailing rule, and the two locale keys (`mobile.composer.pickModel`, `mobile.composer.pickEffort`) are removed from `src/client/mobile-adapt.ts`, the zh/en dictionaries, and the ru language pack. The official model/effort text trigger stays visible on the phone behind its existing trailing-line rules; the v79 bottom-sheet rules that reshape the official menu into a touch-friendly sheet (seat transform freed, menus pinned to the viewport bottom, 44 px cells) are kept, so selecting a model or an effort level still works on the phone through the official control.

## Alternatives considered

- **Keep the buttons behind a settings toggle.** Rejected: the user asked for the buttons to be removed, not for another switch; an off-by-default toggle would leave the drill-through machinery, the body class, and the locale keys in the shipped bundle for a surface nothing requests.
- **Remove the bottom-sheet picker rules as well.** Rejected: those rules adapt the *official* menu (it anchors `right: 0` to a ~170 px trigger and flew past the phone's left edge); without them the official picker is unusable on a phone. Only the plugin-owned buttons go.
- **Keep the buttons but stop hiding the official trigger.** Rejected: that leaves two parallel controls for the same fields in one row — the duplication, not the hiding, is the reason the buttons had no place.
- **Leave the drill-through helpers in the file for a possible revival.** Rejected: dead code with no caller; git history holds the implementation if the design returns.

## Consequences

- The phone composer shows the official model/effort text trigger again; the context ring and send button return to their official trailing-line positions.
- The compact-picker contract tests are inverted into removal guards: the generated sheet must not contain `dsh-remote-compact-picker`, `dshRemoteModelPick`, or `dshRemoteEffortPick`, and a behavioral spec asserts the sync tick injects no button into the composer tools row.
- The two ru keys leave `packages/dsh-i18n/src/client/ru/remote-web-ui.ts` with their zh/en sources, so `pnpm i18n:check` stays green; the note in [the v79 note](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md) and [the phone remote surface note](../bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md) records the removal in place.
- The aggregate client bundle (`packages/dsh-web-all/lib`) carries the inlined bundle, so it is rebuilt and its fingerprint re-recorded with this change.
