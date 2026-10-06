/**
 * QA harness for the blue-fantasy Windows whole-window frame fix (issue #1803).
 *
 * The Windows desktop shell cannot be reproduced in this session (the running
 * host is the web one), but the part that decides the outcome can be: the shell
 * paints an opaque background on a whole-window frame element that wraps the
 * conversation column, and the skin center appends the host's illustration to
 * <body> as a z-index: -2 layer (src/client/runtime/decoration-layers.ts). This
 * harness mounts exactly that stack in real Chromium and serves the skin's own
 * bytes as the skin center serves them
 * (market/dist/tryon-assets/skins/blue-fantasy/*, the transformSkinCss output),
 * so the screenshots and the sampled pixels show whether the illustration
 * survives the frame.
 *
 * The fixture reproduces the reporter's F12 trace
 * (https://github.com/zhu1090093659/dsh-web/issues/1803): HTML #e8ecf5 from the
 * skin, BODY transparent, and DIV.BynINW_frame painted with the skin's own
 * --dsw-specific-sidebar-fill, which is rgb(29, 37, 57) in the dark theme.
 *
 * Run from the repository root:
 *   node docs/archive/2026-10-05-blue-fantasy-frame-1803/qa-frame.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const SKIN = path.join(ROOT, 'market', 'dist', 'tryon-assets', 'skins', 'blue-fantasy')
const ART = path.join(ROOT, 'market', 'dist', 'assets', 'skins', 'blue-fantasy', 'assets', 'whale-art.jpg')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const [skinCss, patchesCss] = await Promise.all([
  readFile(path.join(SKIN, 'skin.css'), 'utf8'),
  readFile(path.join(SKIN, 'patches.css'), 'utf8'),
])
const art = await readFile(ART)

/**
 * The Windows shell as the reporter traced it.
 *
 *  - <body> carries the dark theme attribute and stays transparent, so the
 *    -2 illustration layer appended to it can show (the reporter's trace);
 *  - .BynINW_frame is the shell's whole-window frame, painted with the skin's
 *    own --dsw-specific-sidebar-fill;
 *  - the conversation column is a descendant of the frame, which is why the
 *    frame's paint covers the illustration.
 */
const fixture = (withFix) => `<!doctype html>
<html data-dsh-skin="blue-fantasy"><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  /* The reporter's F12 trace reads HTML bg=rgb(232,236,245) (the skin's own
     :root light colour) and BODY bg=rgba(0,0,0,0): the desktop shell leaves
     body transparent. The skin's dark block paints body[data-ds-dark-theme], so
     the host's transparent body is restated here at the same precedence to keep
     the fixture on the traced values. It is the same in both variants, so it
     does not affect the before/after comparison of the frame rule. */
  body[data-ds-dark-theme] { background: transparent !important; }
  .BynINW_frame { position: relative; height: 100vh; background: var(--dsw-specific-sidebar-fill); }
  .sidebarCol { position: absolute; inset: 0 auto 0 0; width: 260px; }
  .centerCol { position: absolute; inset: 0 0 0 260px; }
  .copy { position: absolute; left: 40px; top: 40px; color: #dbe2f2; font: 16px system-ui; }
</style></head><body data-ds-dark-theme>
  <div data-dsh-skin-layer="background" aria-hidden="true"
       style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none">
    <img src="/whale-art.jpg" alt="" aria-hidden="true"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  </div>
  <div id="root">
    <div class="BynINW_frame">
      <div class="sidebarCol"></div>
      <div class="centerCol"><div class="copy">conversation column</div></div>
    </div>
  </div>
  <style id="skin">${skinCss}</style>
  <style id="patches">${withFix ? patchesCss : patchesCss.replace(/\[class\*="_frame"\] \{[^}]*\}/, '')}</style>
</body></html>`

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  if (url === '/whale-art.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }).end(art); return }
  res.writeHead(200, { 'content-type': 'text/html' }).end(fixture(url === '/fixed'))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + String(server.address().port)

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark' })

/** Render one variant and read what the user would see. */
async function capture(route, file) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base + route, { waitUntil: 'load' })
  await page.waitForTimeout(400)
  const observed = await page.evaluate(async () => {
    const frame = document.querySelector('.BynINW_frame')
    const img = document.querySelector('img')
    if (img !== null && img.decode !== undefined) await img.decode().catch(() => {})
    return {
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      frameBackground: getComputedStyle(frame).backgroundColor,
      artLoaded: img !== null && img.complete && img.naturalWidth > 0,
    }
  })
  // Screenshot AND the actual rendered pixels: a computed-style read alone
  // cannot show whether the illustration survives underneath, and two dark
  // frames are indistinguishable by eye. The PNG is decoded with the browser
  // itself (canvas) rather than a native image dependency.
  const shot = await page.screenshot({ path: path.join(HERE, file) })
  const pixels = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx2d = canvas.getContext('2d')
    ctx2d.drawImage(bitmap, 0, 0)
    const sample = (x, y) => Array.from(ctx2d.getImageData(x, y, 1, 1).data)
    // A sweep across the conversation column: a flat fill yields one colour,
    // the illustration yields many.
    const row = ctx2d.getImageData(0, Math.floor(bitmap.height / 2), bitmap.width, 1).data
    const distinct = new Set()
    for (let x = 0; x < bitmap.width; x += 4) {
      distinct.add([row[x * 4], row[x * 4 + 1], row[x * 4 + 2]].join(','))
    }
    return {
      columnCentre: sample(Math.floor(bitmap.width * 0.7), Math.floor(bitmap.height * 0.5)),
      distinctColoursAcrossColumn: distinct.size,
    }
  }, Array.from(shot))
  await page.close()
  return { ...observed, pixels, errors }
}

const before = await capture('/upstream', '01-upstream-frame-opaque.png')
const after = await capture('/fixed', '02-fixed-frame-transparent.png')

await browser.close()
server.close()

const report = {
  note: 'before = the skin without the frame rule; after = the shipped patches.css',
  before,
  after,
  verdict: {
    frameOpaqueUpstream: before.frameBackground !== 'rgba(0, 0, 0, 0)',
    frameTransparentAfter: after.frameBackground === 'rgba(0, 0, 0, 0)',
    illustrationVisibleUpstream: before.pixels.distinctColoursAcrossColumn > 1,
    illustrationVisibleAfter: after.pixels.distinctColoursAcrossColumn > 1,
    artLoaded: after.artLoaded,
    noConsoleErrors: after.errors.length === 0,
  },
}
await writeFile(path.join(HERE, 'qa-result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
