# Agent Note: the market dist must be regenerated after a satellite pin bump

Status: implemented

## Problem

Issue #1802 reports that enabling whale-fantasy on the Windows desktop client
makes the caption's 应用 / 编辑 menus disappear and become unclickable. Three
skins (`whale-fantasy`, `rainy-night`, `xinghai-heart`) lifted the application
body with

```css
body > #root,
body > div:not([data-dsh-skin-layer]):not([data-dsh-plugin]):not([role]):not([class]) {
  position: relative;
  z-index: 2;
}
```

The desktop shell's Windows caption menu host is a bare `<div data-windows-menu>`
(`apps/desktop/src/preload-menu.ts` in the DSH checkout) whose `role="menubar"`
lives inside its shadow tree, so the fallback matched it and rewrote its
`position: fixed` + `z-index: 1100` into `relative` + `2`.

The skin-side fix was correct and already merged in
[dsh-skins](https://github.com/zhu1090093659/dsh-skins) (PR #47, `71366cc`, merged
as `118d5aa`), and `dev` had already moved its `satellites/dsh-skins` pin past
it. **The published catalogue still served the broken stylesheets**, because the
`market/dist` artifacts were never regenerated from that pin: on the `dev` tip,
`node scripts/market-build --check` failed and named exactly the skins whose
source had been fixed.

## Decision

Regenerate `market/dist` from the pin `dev` already records. The gitlink is
**not** moved by this change: `4340e9b` already contains the lift-rule fix, so
the only missing step was the build.

The regenerated set is four skins, because the pin also carried an earlier,
already-merged fix that had not been published either:

- `whale-fantasy`, `rainy-night`, `xinghai-heart` — the lift rule now anchors
  `body > #root` alone (issue #1802);
- `blue-fantasy` — the Windows whole-window frame rule for issue #1803.

Generated artifacts are a pure function of the pinned content, so a republish
cannot be narrowed to a subset: `market:check` compares the whole tree against a
rebuild from the pin, and shipping the #1802 skins while withholding the #1803
one would leave the tree inconsistent with its own gate.

## Alternatives considered

- **Regenerating only the three #1802 skins by hand**: rejected. It would leave
  `market:check` red and put hand-edited bytes into a generated tree, so the next
  full build would revert it.
- **Leaving the republish to the next scheduled market build**: rejected. The
  defect is user-visible on Windows today, and the pin that fixes it is already
  merged; waiting only extends the window in which the store serves broken CSS.
- **Moving the gitlink again to the fix branch commit (`71366cc`)**: rejected.
  That commit is not a descendant of the intake round `aa71c04` that `dev`
  already pinned, so it would have dropped lucy-nightsignal and the crt-phosphor
  provenance fix from the catalogue.

## Consequences

- `market:check` passes again on the branch; the diff is the four skins'
  `patches.css`, their `tryon-assets` copies, their archives and `styles.js`.
- The date-only `"generated"` fields in the five manifests are deliberately left
  at their committed values so the republish carries no content-free churn.
- The underlying process gap is worth noting: a satellite pin bump is only half
  the change. When the pinned content alters skin CSS or assets, the pin and the
  regenerated `market/dist` must land together, or the store keeps serving the
  old bytes while the repository looks fixed.

## Verification

- `node scripts/market-build --check` fails on the `dev` tip before this change
  (naming the four skins) and passes after it.
- dsh-skins: `pnpm test` (599 tests, incl. the classless-body-child guard),
  `pnpm skin-center:check`, `pnpm skin-hooks:check`, `pnpm typecheck`, and
  `pnpm build` with no `lib/` drift. The guard was negative-controlled:
  reintroducing the old selector fails it.
- dsh-web: `test:scripts`, `test:standards`, `docs:check`, `i18n:check`,
  `emoji:check`, `libs:check`, `aggregate:check`, `pnpm -r test`,
  `pnpm -r typecheck`.
- Not verified in the running GUI: the Windows caption menu is injected only by
  the packaged Windows desktop client, which this environment does not run; the
  reporter's own mitigation screenshot on the issue is the field evidence for
  the mechanism.
