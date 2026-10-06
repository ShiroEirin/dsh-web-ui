# blue-fantasy Windows whole-window frame fix (issue #1803)

Frozen verification snapshot for [zhu1090093659/dsh-web#1803](https://github.com/zhu1090093659/dsh-web/issues/1803).

## What the fix is

`skins/blue-fantasy/patches.css` (dsh-skins) clears the Windows desktop shell's whole-window frame:

```css
[class*="_frame"] {
  background: transparent !important;
}
```

## What this directory holds

| File | Contents |
| --- | --- |
| `qa-frame.mjs` | The harness: serves `market/dist/tryon-assets/skins/blue-fantasy/*` (the `transformSkinCss` output the skin center actually applies) into real Chromium, mounts the reporter's DOM stack, screenshots both variants and samples the rendered pixels. Run from the repository root: `node docs/archive/2026-10-05-blue-fantasy-frame-1803/qa-frame.mjs`. |
| `01-upstream-frame-opaque.png` | The skin without the frame rule: the whole window is flat `#1d2539`, the whale illustration is not visible. |
| `02-fixed-frame-transparent.png` | The shipped stylesheet: the frame paints nothing and the illustration shows. |
| `qa-result.json` | The sampled computed styles and pixels behind the two screenshots. |

## Fixture fidelity

The harness reproduces the reporter's F12 ancestor chain, and its "before" variant computes the traced values:

```
HTML   bg=rgb(232, 236, 245)   the skin's own :root light colour
BODY   bg=rgba(0, 0, 0, 0)     the host leaves body transparent
DIV.BynINW_frame  bg=rgb(29, 37, 57)   the skin's --dsw-specific-sidebar-fill at scrim 0
```

The illustration layer is mounted as the skin center mounts it: a `z-index: -2` element appended to `<body>` (`src/client/runtime/decoration-layers.ts`), which is why the frame — a later-in-flow ancestor of the conversation column — covers it.

## Result

```
before  frameBackground rgb(29, 37, 57)      1 distinct colour across the column (flat fill)
after   frameBackground rgba(0, 0, 0, 0)   184 distinct colours across the column (illustration)
```

The Electron compositor itself cannot be reproduced in this session; the Windows-visible outcome rests on this fixture plus the reporter's own before/after and the #1763 desktop measurements.
