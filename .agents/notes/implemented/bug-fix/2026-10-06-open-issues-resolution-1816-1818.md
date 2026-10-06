# Agent Note: Open issue resolution (#1816, #1818)

Status: implemented

## Problem

Two open reports, one shared root mechanism.

1. **#1816 — the Plugins page toggle failed with "HMR transactions cannot be nested".** Enabling or disabling a row (notably the bundle-default-off rows `web-ui-liangshen`, `web-ui-ssh`, `web-ui-skill-explorer`) raised `组件启用失败：HMR transactions cannot be nested` and `cordis.patch.yml` was left byte-for-byte unchanged. The reporter measured both published versions and found the write section byte-identical, so 0.4.4 to 0.4.5 could not fix it. The write at `src/host/routes.ts` ran on the caller's async context, and `cordis.patch.yml` is exactly the file the HMR config watcher refreshes from; the watcher's refresh re-enters `hmr.runExclusive`, which rejects a nested transaction. This is the same defect the family already corrected for its settings save in [the #1743/#1751 batch](2026-09-29-open-issues-resolution-1743-1751.md).

2. **#1818 — the phone send button sat outside the composer card, flush to the screen edge.** On an iPhone in portrait the send button was hard to reach, and because the adaptation rewrites Enter to a newline the button is the only send path. The reporter could not confirm the real selector and noted that changing `[class$="_composerSeat"] [class$="_primary"]` `right` (56/104/304px) and `_frame` `padding-right` changed nothing on device.

## Decision

1. **The set-enabled write leaves the caller's async context (#1816).** `setEnabledHandler` schedules its `writePatchAtomic` through `runDetached` and still awaits it, so the response reports the real write outcome and the snapshot read below stays ordered.

   The detach mechanism moves into `shared/host/detached-work.ts` and is registered in `scripts/sync-shared.mjs` for both consumers — `dsh-remote-web-ui` (its LAN-bind write, the original #1751 site) and `dsh-plugin-manager` (this write). One mechanism, two copies, drift-checked by `sync-shared --check`. The module header carries the corrected premise from [#1754](2026-09-29-open-issues-resolution-1743-1751.md): a bare `setImmediate` does NOT start a fresh AsyncLocalStorage store — Node propagates the store into timers, promise continuations and any AsyncResource scoped to the current async id — so the write is scheduled through a module-scope `AsyncResource` created with `triggerAsyncId: 0`, before any transaction exists.

2. **The trailing line contains its own padding (#1818).** The adaptation forces the trailing line onto its own row at `flex-basis:100%` and gives it 116px of side padding (38px left for the command button, 78px right for the send button). Under the default `content-box` that padding is ADDED to the 100% basis, so the line's own box overflowed the card by exactly 116px and dragged the absolutely-positioned send button out with it. Adding `box-sizing:border-box` to that one rule contains the padding inside the basis. The card geometry is untouched — the button moves back in, the card does not grow.

   Measured in Chrome at 393x852 with the official `ConversationRoot`/`InputBar` CSS modules plus the real adaptation sheet: before the fix the card ended at x=367 while the trailing line measured 443px wide and the send button sat at x=433..467 — past the viewport's right edge. After the fix the line is 327px, the button lands at x=317..351, and it is inside the card at every width probed (320/360/393/430). That 116px overflow is also why the reporter's `right` overrides appeared to do nothing: the rule did match, but re-anchoring the button inside an already-overflowing line leaves it outside the card.

## Alternatives considered

- **Ship the reporter's `setImmediate` patch verbatim (#1816).** Rejected: it is the exact premise #1754 disproved by measurement in this family. It may appear to work under light load, but it does not detach, so the failure can return. The module-scope `AsyncResource` is the same shape of change with a mechanism that actually holds.
- **Copy `detached-work.ts` into `dsh-plugin-manager` without moving it to `shared/`.** Rejected: two hand-maintained copies of a subtle async-hooks mechanism drift, and this repository already has one home for family-shared runtime modules. The shared manifest is the owning seam.
- **Give the trailing line a smaller `flex-basis` or drop the padding instead (#1818).** Rejected: the padding is load-bearing (it keeps the command button and the send button clear of each other and of the row's own content), and a `calc(100% - 116px)` basis encodes the same number in a second place. `border-box` states the actual intent — the padding belongs inside the line.
- **Re-anchor the send button with an absolute `right` offset (#1818).** Rejected: the button's own rule was never the defect, and pinning it to a hand-tuned offset would re-break the moment the official row gains or loses a control. Containing the line fixes the geometry for every child at once.
- **Verify #1816 end-to-end in this repository.** Not possible as a repository test: `@deepseek-ai/dsh-hmr` is not a dependency here (tests must not reach into a DSH checkout), so the transaction cannot be booted. An isolated harness that simulates it was written, found to measure its own double-nesting rather than the defect, and deleted rather than kept as false evidence. The regression coverage is therefore the family's shape: the placement rule (`set-enabled-hmr-nesting.spec.ts`) plus the mechanism (`detached-work.spec.ts`).

## Consequences

- The Plugins page toggle writes its override row again, and the row takes effect on the next profile apply. The write is still awaited, so a failed write still fails the request rather than reporting success.
- On a portrait phone the send button sits inside the composer card's bottom-right corner at every width probed, so the only send path is reachable one-handed.
- `shared/host/detached-work.ts` is the family's single home for this mechanism; `dsh-remote-web-ui/src/detached-work.ts` and `dsh-plugin-manager/src/host/detached-work.ts` are generated copies and must be changed through the shared source.
- The aggregate client bundle carries the inlined adaptation sheet, so `packages/dsh-web-all/lib` is rebuilt and its fingerprint re-recorded.
- Neither fix can be confirmed on the reporter's hardware from here: #1816 needs a real Host with `dsh-hmr` mounted and #1818 needs a real iPhone. The #1816 mechanism is the one this family already validated in production for the same failure; the #1818 geometry is measured in Chrome against the official CSS modules.

## Testing

- `packages/dsh-plugin-manager/tests/set-enabled-hmr-nesting.spec.ts` pins the placement rule: the write goes through `runDetached`, the detach wraps the scheduling rather than sitting inside the callback, the write is awaited before the snapshot, and the current-vs-desired guard still suppresses a no-op write.
- `packages/dsh-plugin-manager/tests/detached-work.spec.ts` pins the mechanism on this package's copy: a bare `setImmediate` still observes the transaction, `runDetached` does not, nested deferrals stay detached, and the caller keeps its own context.
- `packages/dsh-remote-web-ui/tests/mobile-adapt.spec.ts` pins the `border-box` declaration on the trailing rule together with its 100% basis and 78px right padding, so the rule cannot silently lose the containment again.
