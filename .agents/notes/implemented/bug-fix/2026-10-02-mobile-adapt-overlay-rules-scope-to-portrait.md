# Agent Note: The portrait adaptation's settings-modal rules are gated to the portrait body class

Status: implemented

## Problem

Issue #1776 reported the remote Web UI as badly broken on a phone while the
desktop local Web UI was fine, and suspected `dsh-claude-style`. The attached
screenshot did not show the described layout damage: it showed the
`status.lanRequired` notice, which is the plugin's own "server is bound to
127.0.0.1 and no public address is configured" panel — a binding-state card,
not a layout failure.

Reproducing the reported combination on a real host settled the theme
question. A scratch DSH with `@linxin666/dsh-remote-web-ui` 0.4.4 plus
`dsh-claude-style` 0.10.1, driven at an iPhone 13 viewport, produced a
correct portrait layout: body carried `dsh-remote-portrait`, the adaptation
stylesheet was present, the composer sat inside its card, and the settings
modal opened as a single column with a horizontally scrolling section nav. A
same-run A/B that removed the claude-style stylesheet changed the composer
geometry only by the theme's own decoration, not by a broken layout. The
theme is not the trigger.

The same reproduction did surface a real defect, one layer away from the
report. The v68 settings-modal rules — the only rules in `ADAPT_CSS` that
reshape an official *two-column* surface — carried no body-class gate, while
every suppression in the same array did. `[class$="_overlay"] [class$="_panel"]`
therefore matched whenever the injected `<style>` tag was in `<head>`,
which the sync tick keeps alive independently of the portrait state. Measured
on a real 1440x900 host: the official settings panel is `flex-direction: row`
with a 188 px nav beside a 612 px content column; with the unscoped rule
applied it became `flex-direction: column`, the nav shrank to 236 px tall and
the content grew to the full 800 px below it. The phone layout that #1776
describes — content stacked and squeezed — is exactly what this rule produces,
on whichever viewport the tag survives onto.

## Decision

Every settings-modal rule in `ADAPT_CSS` is gated to `body.dsh-remote-portrait`,
matching the suppressions already in the array. The column switch is a phone
adaptation of a desktop two-column panel, so it is correct only while the
portrait class is on the body; the shared overlay portal must keep the
official layout everywhere else.

## Alternatives considered

- **Remove the rules and let the phone keep the 800 px two-column panel.**
  Rejected: the panel is a fixed 800 px inside a ~342 px phone viewport, so the
  content column would be unreadable. The column switch itself is correct.
- **Scope the tag instead of the selectors** (never inject while desktop).
  Rejected: the tag is page-wide state that the sync tick restores, so its
  presence is not a reliable proxy for "this viewport is portrait". Gating the
  rules makes each one self-describing and testable.
- **Raise the theme's specificity and blame `dsh-claude-style`.** Rejected by
  the A/B: the portrait layout is correct with the theme installed. Editing
  another plugin's cascade to fix this package's rule would hide the defect.

## Consequences

The desktop settings panel keeps its official two-column layout regardless of
the adaptation tag's presence, and the phone keeps the single-column panel with
the scrolling nav row. The rules now assert `body.dsh-remote-portrait` in the
generated CSS, so a future rule added to that group must carry the gate or the
regression test fails.

## Required verification

Measured on a real host, mobile and desktop, with the built bundle installed:

- portrait (iPhone 13, 390x664): body carries `dsh-remote-portrait`, panel
  `flex-direction: column`, nav 342x52 above content 342x564.
- desktop (1440x900): body carries no portrait class, panel
  `flex-direction: row`, nav 188x800 beside content 612x800 (side by side).
- Before the fix, the same desktop run with the rule injected measured
  `flex-direction: column`, nav 188x236, content 800 wide at y=286.

The conversation surface was exercised too, not only the shell: a message sent
from the phone rendered as a user bubble at 186x42 (right edge 378 on a 390
viewport) inside a session whose header activated `dsh-remote-header-seated`,
with no horizontal overflow and no intersecting boxes among the message rows,
the header, the tabs and the composer. The theme plugin was installed for that
run, so the phone conversation page is correct with the theme present.

## Linked notes

- [Phone remote surface — session taps swallowed by a skin decoration, and five adaptation defects](2026-09-09-mobile-remote-tap-and-adaptation-fixes.md)
