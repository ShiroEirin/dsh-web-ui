// 用系统 Chrome 打开 market/dist 的本地静态服务，验证背景动效的缺省关闭与持久化。
// 证据截图写到 docs/archive/market-motion-qa-20261002/。
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), 'market', 'dist')
const SHOTS = path.join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'archive', 'market-motion-qa-20261002')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' }

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0])
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel)
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
await mkdir(SHOTS, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const errors = []
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

// 统计 RAF 是否真的在跑：注入计数器，观测两秒内新增帧数。
const rafProbe = () => `(() => {
  window.__frames = 0
  const orig = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => orig((t) => { window.__frames++; return cb(t) })
})()`

// 1) 首次访问（无本地偏好）：应关闭、按钮显示关闭、无动画帧。
await page.addInitScript(rafProbe())
await page.goto(base, { waitUntil: 'load' })
await page.waitForTimeout(1500)
const first = await page.evaluate(() => ({
  enabled: window.marketWave ? window.marketWave.isEnabled() : null,
  frames: window.__frames,
  stored: localStorage.getItem('dsh-market-motion'),
  label: document.querySelector('#motion').textContent.trim(),
  aria: document.querySelector('#motion').getAttribute('aria-pressed'),
  canvasReady: document.querySelector('#bgCanvas').classList.contains('ready'),
  canvasOpacity: getComputedStyle(document.querySelector('#bgCanvas')).opacity,
}))
await page.screenshot({ path: path.join(SHOTS, '01-default-off.png') })

// 2) 打开动效：应运行、写入 localStorage=1、按钮文案变为开启。
await page.evaluate(() => { window.__frames = 0 })
await page.click('#motion')
await page.waitForTimeout(1500)
const on = await page.evaluate(() => ({
  enabled: window.marketWave.isEnabled(),
  frames: window.__frames,
  stored: localStorage.getItem('dsh-market-motion'),
  label: document.querySelector('#motion').textContent.trim(),
  aria: document.querySelector('#motion').getAttribute('aria-pressed'),
  canvasReady: document.querySelector('#bgCanvas').classList.contains('ready'),
}))
await page.screenshot({ path: path.join(SHOTS, '02-enabled.png') })

// 3) 刷新：应仍然开启（持久化生效）。
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1200)
const afterReload = await page.evaluate(() => ({
  enabled: window.marketWave.isEnabled(),
  frames: window.__frames,
  label: document.querySelector('#motion').textContent.trim(),
}))

// 4) 关闭并刷新：应保持关闭，且画布不可见（真正的关闭，不是留最后一帧）。
await page.click('#motion')
await page.waitForTimeout(800)
await page.evaluate(() => { window.__frames = 0 })
await page.waitForTimeout(1500)
const off = await page.evaluate(() => ({
  enabled: window.marketWave.isEnabled(),
  frames: window.__frames,
  stored: localStorage.getItem('dsh-market-motion'),
  label: document.querySelector('#motion').textContent.trim(),
  canvasReady: document.querySelector('#bgCanvas').classList.contains('ready'),
  canvasOpacity: getComputedStyle(document.querySelector('#bgCanvas')).opacity,
}))
await page.screenshot({ path: path.join(SHOTS, '03-closed-after-toggle.png') })

await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1200)
const afterCloseReload = await page.evaluate(() => ({
  enabled: window.marketWave.isEnabled(),
  frames: window.__frames,
  label: document.querySelector('#motion').textContent.trim(),
  canvasOpacity: getComputedStyle(document.querySelector('#bgCanvas')).opacity,
}))

console.log(JSON.stringify({ first, on, afterReload, off, afterCloseReload, consoleErrors: errors }, null, 2))

await browser.close()
server.close()
