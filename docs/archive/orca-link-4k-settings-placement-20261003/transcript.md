# ORCA LINK settings dialog placement on a 4K display

Validation for [dsh-skins#36](https://github.com/zhu1090093659/dsh-skins/pull/36) /
[dsh-web#1793](https://github.com/zhu1090093659/dsh-web/pull/1793),
reported in [dsh-web#1792](https://github.com/zhu1090093659/dsh-web/issues/1792).

## What these show

The orca-link skin docked the settings dialog into the lower-left corner with
fixed-pixel CSS, so on a 4K display the dialog stayed a 760x680 box in the
corner of a 3840x2160 screen. Files 01 and 03 are that state; files 02 and 04
are the same dialog after the fix, centred.

| file | viewport | dialog box | dialog centre |
| --- | --- | --- | --- |
| 01 | 2560x1440 (4K panel at 150% scaling) | left 294, top 742, 760x680 | 674, 1082 |
| 02 | 2560x1440 | left 900, top 380, 760x680 | **1280, 720** |
| 03 | 3840x2160 (4K panel at 100% scaling) | left 294, top 1462, 760x680 | 674, 1802 |
| 04 | 3840x2160 | left 1540, top 740, 760x680 | **1920, 1080** |

The bold centres are exactly half the viewport in each case. The overlay's
computed style moves from `justify-content: flex-start` / `align-items:
flex-end` with a 294px left padding to `center` / `center` with 18px.

## How they were produced

The repository's own committed try-on shell (`market/dist/tryon`, a
browser-only DSH Web shell) was served on a local port and driven with
Playwright on the installed Microsoft Edge at the two viewports above.

- The settings dialog is the real one, opened through the shell's own
  `设置` control.
- The stylesheet is the committed, build-transformed skin stylesheet from
  `market/dist/tryon-assets/skins/orca-link/`, loaded exactly as the skin
  centre loads it.
- The only difference between a before and an after capture is that the new
  `@media (width >= 1444px)` block is removed from the served stylesheet. The
  server returns either variant from memory, so nothing on disk differs.

## What this is not

This is not a capture of a running `dsh web`. Two things were reproduced by
hand rather than driven, and both are stated so the limit is visible:

- The skin's `hooks.mjs` was not executed. It normally writes
  `data-orca-settings-open`, `data-orca-sidebar-wide` and the measured
  `--orca-sidebar-width` onto `<body>`; the harness sets those three
  directly. The placement rules read only those attributes, so the layout
  under test is unaffected, but the scene layers and the sidebar width
  measurement the hook also performs are absent from these frames.
- `--orca-sidebar-width` was set to 278px, the rail width measured off the
  reporter's own screenshot (417 device px at 150% scaling), so the docked
  frames reproduce that machine rather than an arbitrary one.

The try-on shell is the vendor's frozen build and has no skin manifest, so the
skin centre's own install and try-on flow could not be used to apply the
skin; the stylesheet was injected instead.

## Why there is no screenshot of the running GUI

`dsh web` prints its launch token only to its own console and the token in
`~/.dsh/logs/dsh-web.log` belongs to an earlier run (rejected with 401).
Getting a live one requires restarting the host, which the repository rules
forbid during a session. The shell used here is committed to this repository,
so anyone can reproduce these frames from the same artefacts.
