# Agent Note: Task Board Detail Content Clamp

Status: implemented

## Problem

The task detail overlay rendered the description and the run prompt as full-height markdown with no bound. Cards synced from GitHub issues carry tens of thousands of characters in both fields (the largest observed card holds a 34k-character description and a 35k-character prompt), so opening such a card pushed the execution settings, the schedule editor, and the execution history thousands of pixels down a single scrolling body, and the primary Run action sat effectively out of reach. The frozen-snapshot triplets in the same overlay already capped their height (`promptBlock`, 240px with its own scroll), so two kinds of long text in one view behaved inconsistently.

## Decision

The description and prompt sections render through `ClampedMarkdown` (`packages/dsh-task-board/src/client/board/ClampedMarkdown.tsx`), a clamp wrapper around the existing `TaskMarkdown` renderer:

- The body is capped at 160px (about eight rendered lines) through `.clampBody[data-clamped='true']` in `board.module.css`, with a `::after` gradient fading into the detail surface token `--dsw-alias-bg-base`, so the clamp reads as a preview instead of a hard cut.
- A link-style toggle (`detail.expand` / `detail.collapse`, with `aria-expanded`) lifts and restores the clamp. It is rendered only when the content measurably overflows: the component compares `scrollHeight` against the computed `max-height` (read back from the stylesheet so CSS owns the geometry; a 160px constant covers runtimes without stylesheets, i.e. tests) and re-measures on `source` change, on expand/collapse, and through a `ResizeObserver` for overlay width changes. Measurement works in both states because `overflow: hidden` never truncates `scrollHeight`, and the expanded state reads the fallback constant since its computed `max-height` is `none`.
- A new source starts clamped again, mirroring how the detail overlay resets its edit sessions on a task switch.
- Short content is untouched: no toggle, no fade, no clamp attribute change beyond `data-clamped="false"`.

No ledger field, protocol message, seat contract, or provider surface changes; the clamp is a pure presentation concern inside the detail overlay.

## Alternatives considered

**A plain inner scroll cap (`max-height` + `overflow-y: auto`), matching `promptBlock`.** One line of CSS and already precedent in the same overlay, but it nests a scroll port inside the detail body's scroll port, so wheel gestures get captured by the inner region mid-scroll and mobile touch scrolling chains awkwardly. The clamp keeps one scroll owner and makes the remaining content discoverable through the toggle.

**Collapsible section headers (accordion) for the whole detail body.** Folding entire sections helps a reader who wants the settings, but it changes the default presentation of every card — including short ones — and hides content behind a click even when nothing is long. The clamp only engages past a measured threshold and leaves short cards pixel-identical.

**Tabbed detail layout (content / settings / history).** Solves the crowding by splitting the page, but it is a navigation-model change that hides the run history behind a tab on every open and breaks the existing single-glance reading of a card. Too large a behavioral change for the reported pain.

**CSS `-webkit-line-clamp`.** Line-clamping a container with arbitrary markdown children (headings, lists, code blocks) is unreliable — the clamp counts inlines per block box, not the whole body — and offers no reliable overflow signal for conditionally rendering the toggle. Measured max-height works for any markdown tree.

## Consequences

- The clamp engages at a rendered 160px regardless of content kind; a card whose description is a 200px-tall image-free table or code block also clamps. The toggle restores it, and the fade signals truncation.
- `ResizeObserver` is guarded: runtimes without it (jsdom) simply never re-measure on resize.
- The fade gradient assumes the section sits on the `--dsw-alias-bg-base` surface, which the `.detail` overlay paints; a future restyle that moves markdown onto a different fill must move the fade target token with it.
- No new `data-dsh-part` values were introduced, so the semantic-attrs contract in dsh-skins is untouched; skins keep matching the existing detail parts.
- New locale keys `detail.expand` / `detail.collapse` exist in zh/en (`packages/dsh-task-board/src/client/locales.ts`) and ru (`packages/dsh-i18n/src/client/ru/task-board.ts`), gated by `pnpm i18n:check`.

## Testing

`packages/dsh-task-board/tests/task-detail-clamp.spec.tsx` covers the four states: short content renders without a toggle, overflowing content starts clamped and expands and re-collapses through the toggle, a source change re-clamps an expanded body, and a source shrinking below the clamp retires the toggle. jsdom has no layout engine, so the tests stub `HTMLElement.prototype.scrollHeight` — the single geometry signal the component consumes — with a documented `test-standards-allow` exception. Live verification ran against the real Web GUI (Playwright, Edge) on a synced-issue card with a 34k-character description: both sections clamped to 160px with working toggles, expand revealed the full text, re-collapse restored the compact view, and the schedule, execution history, and status actions all sat within one viewport on desktop and at a 390px mobile viewport, with no console errors.
