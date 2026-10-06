# Phosphor CRT

English | [中文](README.zh.md)

A CRT skin for the dsh web GUI: phosphor green on smoked glass, a dot-matrix
typeface covering Latin and Chinese, baked scanlines and a baked vignette, and
the two netrunner portraits pinned to the input card's edges.

| | |
| --- | --- |
| id | `crt-phosphor` |
| version | 0.1.0 |
| manifest | v2 |
| typeface | Fusion Pixel 12px monospaced (OFL-1.1, bundled) |
| licence | CC BY-NC-SA 4.0 (unofficial fan artwork) |

## Preview

Light theme:

![light](preview/light.jpg)

Dark theme:

![dark](preview/dark.jpg)

Both are 1440x900 JPEG q85 from the market's own facade renderer.

## What it is

- `skin.css` remaps the official tokens: every label and border becomes phosphor
  green, every surface near-black green glass, and all 31
  `--dsw-font-*-font-family` tokens point at the bundled dot-matrix face, which is
  declared with a local `@font-face` (local relative URLs pass the safety
  pipeline; remote ones do not).
- `patches.css` draws the tube: vignette and a slow breathing luminance on
  `#root::before`, a faint bloom and a rare flicker on `#root::after`, phosphor
  bloom plus a whisker of chromatic fringe on text, and the two portraits on
  `body::before` / `body::after`.
- Scanlines are baked into the artwork on purpose: drawn in CSS at a 3px period
  they beat against the device pixel ratio and read as a few thick bands sweeping
  the screen.
- No `hooks.mjs`: the market preview renderer never runs skin hooks, so the tube
  is declarative on purpose.

## Interaction

The submitted skin is **declare-only**: it ships no `hooks.mjs`, because the skin
contract reserves `facets.client` for built-in skins. The optional interactive
version (click the left portrait and she narrates the balance and usage numbers from
the whale widget's pipeline; right-click opens that widget's menu) lives in the
standalone repository `lemonhall/dsh-lucy-companion` together with the rest of the
tooling.

## The portraits

They anchor to `[data-composer-card]` (`left: anchor(--crt-composer left)` plus
`translate: -100% 0` for the left one), so both follow the sidebar and the details
pane without measuring anything, and they paint at `z-index: 900` - above the
shell's layers (15-40), below the whale widget's `9999`.

`--crt-portrait-filter` is the single knob between natural colour with a phosphor
rim and a full green ghost duotone.

## Provenance and copyright

**The artwork is AI-generated.** Every raster asset under `assets/` was produced with
an image model through the OFOX image API and then processed locally. The character
was described in text only: **no photograph, cosplay image or other third-party
picture was used as model input.**

**Which model made what.** The portraits (`lucy-signal-left.webp`,
`lucy-signal-right.webp`) and the two scenes (`scene-light.webp`, `scene-dark.webp`)
come from `volcengine/doubao-seedream-5.0-pro` runs recorded in
`docs/ART-PROVENANCE.md`; the portraits were matted locally by chroma key (key
estimation, alpha ramp, unmix, despill, alpha floor, connected-component despeckle).
Two earlier background attempts used `openai/gpt-image-2.5-sunburst`; they are marked
**superseded** in that document and **no shipped file comes from them**.

**Same origin as the sibling skin.** The portraits are the **same matted assets** as
`skins/lucy-nightsignal` (same author, same submission), and the two scenes here are
that skin's scenes passed through `tools/build_crt_assets.py` (duotone with halation,
baked scanlines, vignette, grain). Both skins therefore carry identical provenance
terms.

**Typeface.** The bundled **Fusion Pixel Font** is redistributed under **OFL-1.1**
(`assets/FUSION-PIXEL-OFL.txt`, upstream licences under `assets/licenses/`). The font
keeps its own licence, independent of this skin.

**Character and source work.** The portraits depict **Lucy / Lucyna Kushinada** from
**Cyberpunk: Edgerunners**. The character design, the work and its setting belong to
their rights holders: **Studio TRIGGER** and **CD PROJEKT RED** (with their respective
licensors and successors).

**Terms of use.** **Personal, non-commercial use only.** This is **unofficial fan
artwork**: it is not affiliated with, endorsed by, sponsored by, or licensed from
Studio TRIGGER, CD PROJEKT RED, the maintainers of this repository, or the DeepSeek
Harness project. All rights to the character and the source work remain with their
rights holders; if a rights holder objects, this skin should be removed.

**Contributor's responsibility.** The contributor accepts responsibility for the
copyright and compliance of this skin, and warrants that they hold the right to
distribute every file in it under the terms stated here: the images are AI-generated
by the models named above, the text and code are the contributor's own work, and the
bundled typeface is redistributed under its own licence. If any part is found to
infringe, the contributor will correct or remove it on request.

**Licence of the skin itself.** The skin's own files (`skin.json`, `skin.css`,
`patches.css`, and `hooks.mjs` where present) are released under **CC BY-NC-SA 4.0** -
see `LICENSE` in this directory and `licenseUrl` in `skin.json`. The repository root
`LICENSE` is BSD-3-Clause and covers the repository's own code, not this skin. Neither
licence grants any rights to the character or the source work.

## Known limitations

- Presentation only: the skin mutates browser styles and never touches a model
  request.
- The face is designed on a 12px grid, so the shell's odd sizes (11, 13, 14, 16)
  are interpolated slightly.
- `patches.css` matches a few CSS-module hash class names, which an official
  rebuild could rename (`dsh-skin validate` warns about this by design).
- The font is 903 KB of the skin's ~1.3 MB; subsetting would cut that roughly in
  half at the cost of rare characters.

The full write-up is in the project repository under `docs/CRT-TECHNIQUE.md`.
