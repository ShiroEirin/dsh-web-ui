// @vitest-environment jsdom
/**
 * Wallpaper thumb fallback: a video wallpaper without a preview image
 * (a bare .mp4 in a manual library folder has no project.json preview)
 * renders its first frame through a <video preload="metadata"> thumb
 * instead of a blank box; entries with a real preview keep the <img>.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WallpaperPanel } from '../src/client/WallpaperPanel.tsx'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'
import type { WallpaperHandle } from '../src/client/wallpaper.ts'

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

const t = (key: SkinCenterKey): string => zh[key] ?? key

// Cached snapshot: useSyncExternalStore loops when getSnapshot returns a
// fresh object on every call.
const NO_DIRS: string[] = []

const stubWallpaper = (): WallpaperHandle => ({
  enabled: () => true,
  selection: () => '',
  mode: () => 'live',
  fit: () => 'cover',
  dim: () => 0,
  wallpaperBlur: () => 0,
  pauseOnHidden: () => false,
  sound: () => false,
  volume: () => 100,
  dirs: () => NO_DIRS,
  addDir: () => {},
  removeDir: () => {},
  activeId: () => null,
  trying: () => false,
  subscribe: () => () => {},
  setEnabled: () => {},
  setMode: () => {},
  setFit: () => {},
  setDim: () => {},
  setBlur: () => {},
  setPauseOnHidden: () => {},
  setSound: () => {},
  setVolume: () => {},
  applySelection: () => {},
  clearSelection: () => {},
  sync: () => {},
  tryOn: () => {},
  exitTryOn: () => {},
  dispose: () => {},
})

const inventory = (wallpapers: unknown[]) => ({
  ok: true,
  installDir: null,
  total: wallpapers.length,
  portableCount: wallpapers.length,
  wallpapers,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  host = document.getElementById('root') as HTMLDivElement
})

afterEach(() => {
  act(() => { root.unmount() })
  vi.unstubAllGlobals()
})

/** Render the panel against one stubbed inventory payload. */
async function render(wallpapers: unknown[]): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => inventory(wallpapers),
  })))
  root = createRoot(host)
  await act(async () => {
    root.render(<WallpaperPanel t={t as never} wallpaper={stubWallpaper()} />)
  })
}

describe('WallpaperPanel thumbs', () => {
  it('falls back to a muted first-frame <video> when no preview image exists', async () => {
    await render([{
      id: 'lib/aurora.mp4',
      title: 'aurora',
      type: 'video',
      source: 'local',
      playable: true,
      updateAvailable: false,
      videoUrl: '/api/skin-center/we/media/AAA',
      webUrl: null,
      frameUrl: null,
      previewUrl: null,
    }])
    const video = host.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('/api/skin-center/we/media/AAA')
    expect(video?.getAttribute('preload')).toBe('metadata')
    expect(video?.muted).toBe(true)
    expect(host.querySelector('img')).toBeNull()
  })

  it('keeps the <img> thumb when the wallpaper has a real preview', async () => {
    await render([{
      id: 'workshop/123',
      title: 'sunset',
      type: 'video',
      source: 'workshop',
      playable: true,
      updateAvailable: false,
      videoUrl: '/api/skin-center/we/media/BBB',
      webUrl: null,
      frameUrl: null,
      previewUrl: '/api/skin-center/we/preview/CCC',
    }])
    const img = host.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/skin-center/we/preview/CCC')
    expect(host.querySelector('video')).toBeNull()
  })
  it('mounts one page, shows page-number buttons and jumps via the input', async () => {
    const wallpapers = Array.from({ length: 25 }, (_, i) => ({
      id: 'w' + i,
      title: 'wallpaper ' + i,
      type: 'scene',
      source: 'local',
      playable: false,
      updateAvailable: false,
      videoUrl: null,
      webUrl: null,
      frameUrl: null,
      previewUrl: null,
      contentrating: 'Everyone',
    }))
    await render(wallpapers)
    const cards = () => host.querySelectorAll('[class*="wallpaperCard"]')
    expect(cards()).toHaveLength(24)
    // Page-number buttons: 1 and 2 (25 items / 24 per page).
    const pageBtns = [...host.querySelectorAll('button')].filter(b => b.textContent?.trim() === '1' || b.textContent?.trim() === '2')
    expect(pageBtns.length).toBe(2)
    // Click page 2 -> the remaining item.
    await act(async () => { pageBtns.find(b => b.textContent?.trim() === '2')!.click() })
    expect(cards()).toHaveLength(1)
    // Jump input: back to page 1.
    const input = host.querySelector('input[type="number"]') as HTMLInputElement
    expect(input).not.toBeNull()
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      nativeSetter.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(cards()).toHaveLength(24)
  })

})
