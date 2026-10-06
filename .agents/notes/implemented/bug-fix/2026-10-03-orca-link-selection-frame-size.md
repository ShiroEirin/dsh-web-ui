# Agent Note: orca-link selection frames were sized to the row, not the picture

Status: implemented

## Problem

Two selection highlights in the orca-link skin did not match the artwork they
belong to. Both were reported as "the frame does not match the image".

**The stage frame around the character.** The corner-bracket frame that appears
when the pointer is over the new-session stage measured 250 x 132 at (22, 58),
while the character is painted in a 250 x 240 box at the same origin. The frame
therefore cut the character off at the waist, and the blue corner wedge floated
at mid-height beside the art. Measured against the status atlas (1888 x 2360,
8 x 10 cells of 236px), the character's ink occupies 216 x 220 of that cell, so
roughly 90px of the picture hung outside its own frame.

**The brand frame around the wordmark.** The keyboard selection highlight on the
top-left DSH wordmark was the host's own `:focus-visible` outline, drawn on the
full-width `wide` row control -- 216 x 30 against a 118 x 30 wordmark -- so it
ran across empty row space and closed over the LINK ACTIVE chip beside it.

Root cause for both: a highlight was painted on a box that is not the picture's
box. For the stage, the frame and the hit plane were one and the same pseudo
element, so the height issue #1743 tuned for the click target was also the
height the user saw. For the wordmark, no skin rule suppressed the global
`:focus-visible` outline on that control, and the skin's own stage frame rides a
sibling control that never reaches the brand button.

## Decision

**The stage frame and the hit plane become two boxes.** The pane now declares
the art box once, as `--orca-art-h` on `[data-dsh-surface="sidebar"] > :first-child`,
which the status character is sized with; the frame reads the same variable, so
the highlight is exactly the rectangle the picture occupies and cannot drift
from it. The hit plane keeps its clipped height and its geometry untouched, and
now paints nothing at all (content and the box only), so issue #1743 -- a plane
that swallows the first plugin rows -- has nothing to regress: no rule about the
plane changed. The corner wedge, the one piece of the frame language that rests
on screen instead of arriving with the hover, moves onto the art element itself
and takes the art's own bottom-right corner (`right: 4px; bottom: 3px`); the old
separately positioned marker drifted with whatever height the frame had.

**The wordmark frame is the wordmark's box.** The same treatment, on the other
picture: the mark's box is declared once as `--orca-mark-x/y/w/h` on the logo
row, read by both the wordmark and a new frame on the row's `:before`, and the
host outline is dropped on the brand control so the only frame around the mark
is the one sized to it. The frame rule names the row's first button positionally
(`:has(> button:first-of-type:is(:hover, :focus-visible))`) rather than through
`[data-orca-link-brand]`: the frame is absolutely positioned, so it paints above
the in-flow button and must opt out of the pointer, and the guard in
`orca-link-hit-targets.spec.ts` fails any rule whose selector text contains
`[data-orca-link-brand]` next to `pointer-events: none`.

## Testing

- Live GUI (running host on port 3080, orca-link active, dark and light sheets
  both served through the skin center). Stage frame measured at idle, hover and
  keyboard focus: x=22 y=58 **250 x 240**, edge for edge with the character box,
  opacity 0 -> .62 on hover and .92 on focus. The hit plane is unchanged at
  250 x 132.
- The wordmark frame measures x=16 y=21 **118 x 30**, equal to the wordmark's own
  rect on all four edges, at opacity .5 on hover and 1 on focus, with the button's
  outline-style `none`.
- Issue #1743 does not regress: the plane still ends at y=190 while the first
  plugin row starts at y=310, `elementFromPoint` at each row's centre resolves to
  that row's own button, and clicking the 插件 row opens the plugins panel.
- Clicking the character still reaches the new-session control; no page errors.
- The collapsed rail is untouched: at 320px the art measures 0 x 0, the frame
  rule resolves to `content: none` (it is scoped to `body[data-orca-sidebar-wide]`,
  as is the wedge), and the rail's own 6px dialog marker is unchanged.
- `pnpm test` (776 tests, 53 files), `pnpm typecheck`, `pnpm skin-center:check`
  and `pnpm skin-hooks:check` pass in dsh-skins.

## Alternatives considered

- **Grow the hit plane to the art box as well.** Rejected for now: the pane
  geometry leaves only 12px between the art's bottom edge and the first plugin
  row, and #1743 was a real swallowed-navigation bug. The visible frame is what
  the user asked about; the click target can follow once the plane and the list
  stop depending on the same number. The two are now separate, so that change is
  a one-line follow-up if it is ever wanted.
- **Paint the stage frame on the character element.** Rejected: that element
  carries a `clip-path` wipe and opacity transitions, so the frame would be wiped
  in with the art instead of answering the pointer.
- **Resizing the host brand button to the wordmark.** Rejected: the host owns the
  row layout, and the button's width is the New Session hit area; the note from
  2026-09-10 made the wordmark the visible affordance, so the click surface should
  stay at least as large as the visible control.
- **Scoping the wordmark frame with `:has()` on the wordmark instead of the
  button.** Rejected: the trigger states must be the button's, and the same
  `pointer-events` guard would fail the rule. The positional spelling is the one
  the sheet already uses for this row's first control.

## Consequences

- Both highlights now read as the pictures they belong to. The fix ships with
  the skin assets: an installed skin picks it up on the next skin update or
  reinstall, and a page refresh is enough once the files change (verified live).
- `--orca-art-h` and `--orca-mark-x/y/w/h` are the single sources for the two
  picture boxes. A change to either picture's size must go through them, or the
  frame and the image drift apart again.
- The stage frame is purely decorative: the hit plane below it is the only
  pointer target, which is what keeps #1743 structurally rather than numerically
  guarded. The guard spec now asserts the split in both directions: the plane
  paints nothing, and the frame is the art's box.
