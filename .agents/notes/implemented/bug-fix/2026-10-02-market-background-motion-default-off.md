# Agent Note: The market home page background motion is off by default and persists

Status: implemented

## Problem

`market/src/index.html` carries a full-screen WebGL fluid-noise shader behind the hero. It is the most expensive thing the page does and it ran on every visit: `market/src/app.js` started a `requestAnimationFrame` loop as soon as the program linked, and the toggle only ever stopped it mid-session. Three problems followed. The cost was paid by everyone for an effect that CSS then made nearly invisible, because `#bgCanvas.ready` sits at `opacity: .42` behind `filter: saturate(.65) brightness(.72)` under a screen-blended whale overlay. The off state was not really off: `setEnabled(false)` only cancelled the frame and left the last frame on screen, so the compositing and the retained GPU buffer stayed. And the choice never survived a refresh, because it was never written anywhere and the page default was on.

## Decision

The background motion is off unless the visitor turns it on, and the choice is remembered.

- `localStorage` key `dsh-market-motion` holds `'1'` or `'0'`; a missing or unparsable value means off. It is read once at the top of `market/src/app.js` and is the single source both the WebGL layer and the application layer read.
- The WebGL block sizes the drawing buffer but draws no first frame and starts no loop; the first frame is decided by the application layer's `applyMotion()` during `boot()`. With motion off the animation loop never starts at all.
- `window.marketWave.setEnabled(false)` is a real close: it stops the loop, clears the queued click ripples, and removes the canvas `.ready` class so the canvas falls back to `opacity: 0`. `isEnabled()` was added so tests and QA can read the layer's real state instead of inferring it.
- `prefers-reduced-motion: reduce` still wins over the stored choice; the footer button is disabled and reads 背景动效：已遵循系统设置.
- The footer button ships in the document as the off state (`aria-pressed="false"`, 背景动效：关闭) so the first paint already matches the real state instead of flashing 开启 before `boot()` corrects it.

## Alternatives considered

- Keep the default on and only persist the toggle: rejected. It fixes the refresh bug but leaves the cost on every first visit, which is the larger part of the problem: the shader is a per-frame full-viewport pass, and a first-time visitor pays it before ever seeing the effect they are being billed for.
- Pause the loop but keep the last frame, and describe it accurately in the copy: rejected. A retained full-viewport drawing buffer keeps the compositor work and the GPU memory alive, so the cheap-looking option is the expensive one. Calling that 关闭 would also have been the misleading label the change was meant to remove.
- Ship the frame-cost adaptive degradation (drop the star and meteor layers when frames run long) together with the default: deferred. Once the loop does not run at all for the default visitor, the adaptive path only affects people who explicitly opted in, and a quieter but still continuous opt-in effect is the acceptable cost for that group. It stays available as a follow-up if opted-in frame cost turns out to matter.
- Thin the fragment shader: deferred for the same reason. Its cost is only paid when motion is on, and shrinking it would trade away the opt-in experience to speed up the state nobody is in by default.

## Consequences

- The default visit allocates no program, links no shaders, schedules no frames, and keeps no drawing buffer. The whale overlay, header, showcase, and grid are unaffected; they are ordinary DOM and CSS layers.
- A visitor who wants the effect enables it once and it stays enabled across reloads; disabling it once likewise sticks.
- `market/dist` is regenerated and committed, including the `generated` date bump in every manifest.
- When `satellites/dsh-community-plugins` is checked out below its pinned gitlink, `node scripts/market-build` reads the working tree and drops catalog entries. The build must run against the pinned commit: `node scripts/market-fetch-inputs.mjs` without `--local` fetches the pinned content and reports the stale checkout.

## Testing

- `node --test scripts/market-motion-toggle.test.mjs` runs the real `market/src/app.js` in a `node:vm` context against a minimal DOM and WebGL stub, and passes 6 tests: default off, stored on survives reload, stored off survives reload, the footer button persists and syncs its copy and `aria-pressed`, `prefers-reduced-motion` overrides a stored on, and closing stops the loop, clears the canvas, and draws no further frame. Reverting the default to on fails 3 of them, and removing the `writeMotion` call fails the persistence test, so the coverage is not tautological.
- `node scripts/market-motion-qa.mjs` drives the committed `market/dist` in system Chrome over a local static server and counts real animation frames: 0 frames on a first visit, 241 after enabling, 198 after reloading with the stored choice, and 0 again after disabling and reloading, with the canvas at `opacity: 0` in every off state. Screenshots are in `docs/archive/market-motion-qa-20261002/`.
- `node scripts/market-build --check` reports the committed dist up to date; `pnpm market:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:standards`, `pnpm docs:check`, `pnpm i18n:check` and `pnpm emoji:check` all pass.