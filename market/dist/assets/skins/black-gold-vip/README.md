# Black Gold VIP

English | [中文](README.zh.md)

A dsh skin that recolors **only the brand marks**: the sidebar brand row becomes a black-gold
membership card, and the start-session whale gets the same metal gold. Nothing else in the GUI
is touched.

## What it changes

| Where | Effect |
| --- | --- |
| Sidebar brand row | Membership card: gradient metal border, card lighting and a slow sheen sweep; the wordmark and whale are five-stop metal gold |
| `HARNESS` badge | Becomes a ribbon: in the light theme a dark plate with gold letters, in the dark theme a gold plate with dark letters |
| Start-session whale | The same metal treatment |
| Everything else | Untouched: no `--dsw-*` token is declared, layout is unchanged, no component is replaced, the hover swim animation is preserved |

Both themes are covered: light uses a warm ivory card with deep gold, dark uses a near-black
card with bright champagne gold.

## Pure CSS

No hooks, no JS, no dependencies. The metal gradient is a **data-URI SVG used as a CSS
`mask` over a `linear-gradient` background**: user-directory skins cannot run `hooks.mjs`
(the host answers `hooks-require-review`), so the whole gradient is done in CSS.

## Colors

Chroma.js generated the ramps with `lch` perceptual interpolation.

| Role | Light theme | Dark theme |
| --- | --- | --- |
| Card face | ivory `#FFFDF7 → #F4E8D0` | near-black `#1B1B22 → #08080A` |
| Metal band | `#3A2A08 → #6E5416 → #C9A227 → #8A6A22 → #463606` | `#5C4614 → #C9A227 → #F6E7B0 → #C9A227 → #7A5C1A` |
| Ribbon | dark plate, gold letters | gold plate, dark letters |
| Flat fallback | `#ab8625` (3.40:1 on white) | `#e0c671` (11.76:1 on black) |

## Notes for maintainers

- The manifest and these bilingual READMEs follow the v2 contract; `order` is 103 (free at
  submission time).
- The skin is dual-theme **by construction**: every rule carries one light value plus a
  `body[data-ds-dark-theme]` override. It ships brand-mark rules only — no palette — so it
  cannot conflict with any token scheme.
- **Custom properties are deliberately written on a single line**: the serving pipeline is
  line-oriented and truncates a multi-line custom property value, which silently voids the
  variable and turns the `background` that consumes it transparent (observed in practice).
- The ribbon letters are addressed structurally (`g[clip-path*="badge-clip"] path`), never via
  `path[fill*=...]`, which does not match in the real DOM and would leave the letters at
  `fill: none`.
- Brand artwork (the FishLogo / BrandWordmark vector path data) is MIT, Copyright (c) 2026
  DeepSeek; the trademarks belong to DeepSeek. This is an **unofficial** theme, not affiliated
  with DeepSeek. Generator and the full notice live at
  https://github.com/silicon-sbt/dsh-skin-black-gold-vip .
