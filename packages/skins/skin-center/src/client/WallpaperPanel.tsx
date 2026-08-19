/**
 * The wallpaper panel of the skin-center card: lists the user's local
 * Wallpaper Engine library (video / web / scene wallpapers) with live
 * try-on, one-click apply, local import, and render tuning. Rendering and
 * persistence ride the WallpaperController (wallpaper.ts); the library,
 * media, import and scene-frame bytes come from the host's /we routes.
 *
 * Compliance: wallpapers are the user's own local files (their Workshop
 * subscriptions or manual folders). The panel never downloads or shares
 * content; import only copies files within the user's machine.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSelection, type WallpaperDescriptor, type WallpaperHandle } from './wallpaper.ts'
import css from './skin-center.module.css'

/** Host base path of the wallpaper API (mirrors src/we-routes.ts). */
const WE_API = '/api/skin-center/we'

/** Wallpapers rendered per page in the library grid. */
const WALLPAPER_PAGE_SIZE = 24

/** One wallpaper entry as served by the inventory route. */
interface WallpaperItem extends WallpaperDescriptor {
  source: 'workshop' | 'local' | 'imported'
  /** Steam Workshop content rating declared by the project (author-set). */
  contentrating: 'Everyone' | 'Questionable' | 'Mature' | null
  playable: boolean
  updateAvailable: boolean
}

/** Inventory payload shape. */
interface InventoryPayload {
  ok?: boolean
  installDir?: string | null
  total?: number
  portableCount?: number
  wallpapers?: WallpaperItem[]
  error?: string
}

/** Post one wallpaper action and return whether it succeeded. */
async function postWe(path: string, id: string): Promise<string | null> {
  try {
    const response = await fetch(WE_API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
    if (!response.ok || payload?.ok !== true) return payload?.error ?? 'HTTP ' + String(response.status)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The type badge copy key of one wallpaper. */
function typeKey(item: WallpaperItem): 'wallpaperTypeVideo' | 'wallpaperTypeWeb' | 'wallpaperTypeScene' | 'wallpaperTypeApp' {
  switch (item.type) {
    case 'video': return 'wallpaperTypeVideo'
    case 'web': return 'wallpaperTypeWeb'
    case 'scene': return 'wallpaperTypeScene'
    default: return 'wallpaperTypeApp'
  }
}

/** Age-rating buckets offered by the wallpaper filter (G / PG-13 / R18). */
export type WallpaperRating = 'G' | 'PG-13' | 'R18'

/** Explicit R18 marker in a wallpaper title (R18 / R-18). */
const R18_MARKER = /R[- ]?18/i

/** Explicit PG-13 marker (PG-13 / PG13; R13 titles count as PG-13). */
const PG13_MARKER = /(?:PG[- ]?13|R[- ]?13)/i

/** Adult keywords that classify an undeclared title as R18. */
const ADULT_KEYWORDS = /\b(nsfw|x-ray|hentai|porn|nude|sex|ero|lewd)\b|淫|裸|乳|内衣/iu

/** The rating input: the inventory item (official content rating + title). */
export interface RatingSource {
  /** Steam Workshop content rating, when the project declares one. */
  contentrating: 'Everyone' | 'Questionable' | 'Mature' | null
  title: string
}

/**
 * Derive the age rating of a wallpaper from the official three-tier scheme
 * (G / PG-13 / R18). The Steam Workshop content rating declared by the
 * project is authoritative and never overridden: Everyone → G, Questionable
 * → PG-13, Mature → R18. Entries without a declared rating fall back to
 * title markers (explicit R18/R-18 or adult keywords → R18, PG-13/R13 →
 * PG-13, everything else G).
 */
export function ratingOf(item: RatingSource): WallpaperRating {
  if (item.contentrating === 'Everyone') return 'G'
  if (item.contentrating === 'Questionable') return 'PG-13'
  if (item.contentrating === 'Mature') return 'R18'
  if (R18_MARKER.test(item.title) || ADULT_KEYWORDS.test(item.title)) return 'R18'
  if (PG13_MARKER.test(item.title)) return 'PG-13'
  return 'G'
}

/**
 * Page numbers for the pager: current page with one neighbour on each side,
 * ellipsized ends for large totals (1 … 5 6 7 … 32).
 */
function pageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '…'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('…')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push('…')
  pages.push(total)
  return pages
}

/** Render the Wallpaper Engine section of the skin-center card. */
export function WallpaperPanel({ t, wallpaper }: { t: PropsLocale<'skinCenter'>['t']; wallpaper: WallpaperHandle }): ReactNode {
  const enabled = useSyncExternalStore(wallpaper.subscribe, wallpaper.enabled)
  const selection = useSyncExternalStore(wallpaper.subscribe, wallpaper.selection)
  const mode = useSyncExternalStore(wallpaper.subscribe, wallpaper.mode)
  const fit = useSyncExternalStore(wallpaper.subscribe, wallpaper.fit)
  const dim = useSyncExternalStore(wallpaper.subscribe, wallpaper.dim)
  const blur = useSyncExternalStore(wallpaper.subscribe, wallpaper.wallpaperBlur)
  const pauseOnHidden = useSyncExternalStore(wallpaper.subscribe, wallpaper.pauseOnHidden)
  const sound = useSyncExternalStore(wallpaper.subscribe, wallpaper.sound)
  const volume = useSyncExternalStore(wallpaper.subscribe, wallpaper.volume)
  const activeId = useSyncExternalStore(wallpaper.subscribe, wallpaper.activeId)
  const trying = useSyncExternalStore(wallpaper.subscribe, wallpaper.trying)
  const dirs = useSyncExternalStore(wallpaper.subscribe, wallpaper.dirs)
  const [dirInput, setDirInput] = useState('')

  const [items, setItems] = useState<WallpaperItem[] | null>(null)
  const [installDir, setInstallDir] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  /** Active rating filter ('all' shows every wallpaper). */
  const [rating, setRating] = useState<'all' | WallpaperRating>('all')
  /** Current page of the filtered list (1-based; clamped to the page count). */
  const [page, setPage] = useState(1)
  /** Jump-to-page input draft. */
  const [jumpInput, setJumpInput] = useState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /** Wallpapers after the rating filter. */
  const filtered = items === null ? [] : rating === 'all' ? items : items.filter(item => ratingOf(item) === rating)
  /** Items actually mounted: one page only, so the grid stays small. */
  const pageCount = Math.max(1, Math.ceil(filtered.length / WALLPAPER_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = filtered.slice((safePage - 1) * WALLPAPER_PAGE_SIZE, safePage * WALLPAPER_PAGE_SIZE)
  // A new inventory or a new filter restarts at the first page.
  useEffect(() => { setPage(1) }, [rating, items])

  /** Apply the jump input: clamp to [1, pageCount] and land. */
  const jumpToPage = (): void => {
    const target = Number(jumpInput)
    if (Number.isInteger(target) && target >= 1 && target <= pageCount) setPage(target)
    setJumpInput('')
  }

  /** Fetch the inventory and reconcile the mounted layer with the selection. */
  const load = useCallback((): void => {
    void fetch(WE_API + '/inventory')
      .then(async response => {
        const payload = await response.json().catch(() => null) as InventoryPayload | null
        if (!mounted.current) return
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
          setLoadError(payload?.error ?? 'HTTP ' + String(response.status))
          setItems([])
          return
        }
        setLoadError(null)
        setItems(payload.wallpapers)
        setInstallDir(typeof payload.installDir === 'string' ? payload.installDir : null)
        const selected = wallpaper.selection()
        wallpaper.sync(resolveSelection(payload.wallpapers, selected) ?? null)
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setLoadError(error instanceof Error ? error.message : String(error))
        setItems([])
      })
  }, [wallpaper])

  useEffect(load, [load])

  /** Run one import/remove action with the shared busy + error state. */
  const runAction = (id: string, path: string, after?: () => void): void => {
    setActionError(null)
    setWorkingId(id)
    void postWe(path, id).then(error => {
      if (!mounted.current) return
      setWorkingId(null)
      if (error !== null) {
        setActionError(error)
        return
      }
      after?.()
      load()
    })
  }

  const descriptorOf = (item: WallpaperItem): WallpaperDescriptor => ({
    id: item.id,
    title: item.title,
    type: item.type,
    videoUrl: item.videoUrl,
    webUrl: item.webUrl,
    frameUrl: item.frameUrl,
    sceneUrl: item.sceneUrl,
    previewUrl: item.previewUrl,
  })

  /** Whether one entry can be mounted at all in the current mode. */
  const renderable = (item: WallpaperItem): boolean =>
    item.playable || item.frameUrl !== null || item.previewUrl !== null

  const activeSelection = selection

  return (
    <div className={css.wallpaperSection}>
      <div className={css.enableRow}>
        <span className={css.enableLabel} title={t('wallpaperEnable')}>{t('wallpaperTitle')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('wallpaperEnable')}
          className={enabled ? css.switch + ' ' + css.switchOn : css.switch}
          onClick={() => { wallpaper.setEnabled(!enabled) }}
        >
          <span className={css.switchThumb} />
        </button>
        <p className={css.enableHint}>{t('wallpaperHint')}</p>
      </div>
      {enabled && (
        <>
          <div className={css.wallpaperStatus}>
            {loadError !== null
              ? <span className={css.wallpaperStatusError}>{t('wallpaperLoadError')}: {loadError}</span>
              : items === null
                ? <span>{t('loading')}</span>
                : installDir !== null
                  ? <span>{t('wallpaperLibraryFound')} · {items.length}</span>
                  : <span>{t('wallpaperLibraryManual')} · {items.length}</span>}
            <button type="button" className={css.button} onClick={load}>{t('wallpaperRefresh')}</button>
          </div>

          <div className={css.wallpaperRatingTabs} role="group" aria-label={t('wallpaperRating')}>
            {(['all', 'G', 'PG-13', 'R18'] as const).map(value => (
              <button
                type="button"
                key={value}
                className={css.themeButton + (rating === value ? ' ' + css.themeButtonActive : '')}
                aria-pressed={rating === value}
                onClick={() => { setRating(value) }}
              >
                {value === 'all' ? t('wallpaperRatingAll') : value}
              </button>
            ))}
          </div>

          {activeSelection !== '' && (
            <div className={css.wallpaperControls}>
              <div className={css.themeRow}>
                <span className={css.themeLabel}>{t('wallpaperMode')}</span>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'live' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('live') }}
                >
                  {t('wallpaperModeLive')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'frame' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('frame') }}
                >
                  {t('wallpaperModeFrame')}
                </button>
                <button
                  type="button"
                  className={css.button + ' ' + css.buttonGhost}
                  onClick={() => { wallpaper.clearSelection() }}
                >
                  {t('wallpaperClear')}
                </button>
              </div>
              <div className={css.themeRow}>
                <span className={css.themeLabel}>{t('wallpaperFit')}</span>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'cover' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('cover') }}
                >
                  {t('wallpaperFitCover')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'contain' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('contain') }}
                >
                  {t('wallpaperFitContain')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'fill' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('fill') }}
                >
                  {t('wallpaperFitFill')}
                </button>
              </div>
              <div className={css.backgroundRow}>
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperDim')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{dim}%</span>
                </div>
                <input
                  className={css.backgroundRange}
                  type="range"
                  min="0"
                  max="90"
                  step="5"
                  value={dim}
                  aria-label={t('wallpaperDim')}
                  onChange={(event) => { wallpaper.setDim(Number(event.target.value)) }}
                />
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperBlur')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{blur}px</span>
                </div>
                <input
                  className={css.backgroundRange}
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={blur}
                  aria-label={t('wallpaperBlur')}
                  onChange={(event) => { wallpaper.setBlur(Number(event.target.value)) }}
                />
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel}>{t('wallpaperPauseHidden')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pauseOnHidden}
                  aria-label={t('wallpaperPauseHidden')}
                  className={pauseOnHidden ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setPauseOnHidden(!pauseOnHidden) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel} title={t('wallpaperSoundHint')}>{t('wallpaperSound')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sound}
                  aria-label={t('wallpaperSound')}
                  className={sound ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setSound(!sound) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              {sound && (
                <div className={css.backgroundRow}>
                  <div className={css.backgroundHead}>
                    <span className={css.backgroundLabel}>{t('wallpaperVolume')}</span>
                    <span className={css.backgroundValue} aria-hidden="true">{volume}%</span>
                  </div>
                  <input
                    className={css.backgroundRange}
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={volume}
                    aria-label={t('wallpaperVolume')}
                    onChange={(event) => { wallpaper.setVolume(Number(event.target.value)) }}
                  />
                </div>
              )}
            </div>
          )}

          <div className={css.wallpaperDirs}>
            <span className={css.themeLabel}>{t('wallpaperDirs')}</span>
            {dirs.length === 0 && <span className={css.backgroundHintMuted}>{t('wallpaperDirsEmpty')}</span>}
            {dirs.map(dir => (
              <span className={css.wallpaperDir} key={dir}>
                <span className={css.wallpaperDirPath} title={dir}>{dir}</span>
                <button
                  type="button"
                  className={css.wallpaperDirRemove}
                  aria-label={t('wallpaperRemove')}
                  onClick={() => { wallpaper.removeDir(dir); load() }}
                >
                  ×
                </button>
              </span>
            ))}
            <span className={css.wallpaperDirAdd}>
              <input
                className={css.wallpaperDirInput}
                type="text"
                value={dirInput}
                placeholder={t('wallpaperDirPlaceholder')}
                onChange={(event) => { setDirInput(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dirInput.trim() !== '') {
                    wallpaper.addDir(dirInput)
                    setDirInput('')
                    load()
                  }
                }}
              />
              <button
                type="button"
                className={css.button}
                disabled={dirInput.trim() === ''}
                onClick={() => { wallpaper.addDir(dirInput); setDirInput(''); load() }}
              >
                {t('wallpaperDirAdd')}
              </button>
            </span>
            <p className={css.backgroundHintMuted}>{t('wallpaperDirsHint')}</p>
          </div>

          {actionError !== null && <div className={css.error}>{actionError}</div>}

          {items !== null && filtered.length > 0 && (
            <div className={css.wallpaperGrid}>
              {pageItems.map(item => {
                const isApplied = item.id === activeSelection
                const isMounted = item.id === activeId
                const busy = workingId === item.id
                const itemRating = ratingOf(item)
                return (
                  <div className={css.wallpaperCard} key={item.id}>
                    <div className={css.wallpaperThumbWrap}>
                      {item.previewUrl !== null
                        ? <img className={css.wallpaperThumb} src={item.previewUrl} alt="" loading="lazy" />
                        : item.videoUrl !== null
                          // No preview image (bare .mp4 without project.json):
                          // the video element's first frame is the cover.
                          ? <video className={css.wallpaperThumb} src={item.videoUrl} preload="metadata" muted playsInline aria-hidden="true" />
                          : <div className={css.wallpaperThumbEmpty} aria-hidden="true" />}
                      <span className={css.wallpaperType}>{t(typeKey(item))}</span>
                      {itemRating !== 'G' && (
                        <span className={css.wallpaperRatingBadge + (itemRating === 'R18' ? ' ' + css.wallpaperRatingBadgeR18 : '')}>{itemRating}</span>
                      )}
                      {isMounted && (
                        <span className={css.badge + ' ' + (trying ? css.badgeTrying : css.badgeActive)}>
                          {trying ? t('tryingOn') : t('active')}
                        </span>
                      )}
                    </div>
                    <div className={css.wallpaperName} title={item.title}>{item.title}</div>
                    <div className={css.wallpaperActions}>
                      {isMounted && trying ? (
                        <button type="button" className={css.button + ' ' + css.buttonPrimary} onClick={() => { wallpaper.exitTryOn() }}>
                          {t('exitTryOn')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={css.button + ' ' + css.buttonPrimary}
                          disabled={!renderable(item) || (isMounted && isApplied) || busy}
                          onClick={() => { wallpaper.tryOn(descriptorOf(item)) }}
                        >
                          {t('tryOn')}
                        </button>
                      )}
                      <button
                        type="button"
                        className={css.button}
                        disabled={!renderable(item) || isApplied || busy}
                        onClick={() => { wallpaper.applySelection(descriptorOf(item)) }}
                      >
                        {isApplied ? t('active') : t('apply')}
                      </button>
                      {item.source === 'imported' ? (
                        <>
                          {item.updateAvailable && (
                            <button
                              type="button"
                              className={css.button}
                              disabled={busy}
                              title={t('wallpaperUpdateAvailable')}
                              onClick={() => { runAction(item.id, '/reimport') }}
                            >
                              {busy ? t('loading') : t('wallpaperReimport')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={css.button + ' ' + css.buttonGhost}
                            disabled={busy}
                            onClick={() => {
                              runAction(item.id, '/remove', () => {
                                if (wallpaper.selection() === item.id) wallpaper.clearSelection()
                              })
                            }}
                          >
                            {t('wallpaperRemove')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={css.button}
                          disabled={busy}
                          title={t('wallpaperImportHint')}
                          onClick={() => { runAction(item.id, '/import') }}
                        >
                          {busy ? t('loading') : t('wallpaperImport')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {items !== null && items.length > 0 && filtered.length === 0 && (
            <p className={css.backgroundHintMuted}>{t('wallpaperRatingEmpty')}</p>
          )}
          {items !== null && filtered.length > WALLPAPER_PAGE_SIZE && (
            <div className={css.wallpaperPager}>
              <button
                type="button"
                className={css.button}
                disabled={safePage <= 1}
                onClick={() => { setPage(safePage - 1) }}
              >
                {t('wallpaperPagePrev')}
              </button>
              <div className={css.wallpaperPageNumbers}>
                {pageNumbers(safePage, pageCount).map((value, index) =>
                  value === '…'
                    ? <span key={'ellipsis' + index} className={css.wallpaperPageEllipsis} aria-hidden="true">…</span>
                    : (
                      <button
                        type="button"
                        key={value}
                        className={css.wallpaperPageNumber + (value === safePage ? ' ' + css.wallpaperPageNumberActive : '')}
                        aria-current={value === safePage ? 'page' : undefined}
                        onClick={() => { setPage(value) }}
                      >
                        {value}
                      </button>
                    ),
                )}
              </div>
              <button
                type="button"
                className={css.button}
                disabled={safePage >= pageCount}
                onClick={() => { setPage(safePage + 1) }}
              >
                {t('wallpaperPageNext')}
              </button>
              <span className={css.wallpaperPagerInfo}>{safePage} / {pageCount}</span>
              <input
                className={css.wallpaperJumpInput}
                type="number"
                min="1"
                max={pageCount}
                value={jumpInput}
                placeholder={String(safePage)}
                aria-label={t('wallpaperPageJump')}
                onChange={(event) => { setJumpInput(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') jumpToPage() }}
              />
              <button type="button" className={css.button} onClick={jumpToPage}>{t('wallpaperPageJump')}</button>
            </div>
          )}
          {items !== null && items.length === 0 && loadError === null && (
            <p className={css.backgroundHintMuted}>{t('wallpaperEmpty')}</p>
          )}
          <p className={css.backgroundHintMuted}>{t('wallpaperLegal')}</p>
        </>
      )}
    </div>
  )
}
