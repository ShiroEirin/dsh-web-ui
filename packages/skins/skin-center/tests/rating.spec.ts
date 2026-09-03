/**
 * Rating derivation for the wallpaper library grid, following the official
 * three-tier scheme (G / PG-13 / R18). The Steam Workshop content rating
 * declared by the project is authoritative and never overridden: Everyone →
 * G, Questionable → PG-13, Mature → R18. Entries without a declared rating
 * fall back to title markers (explicit R18/R-18 or adult keywords → R18,
 * PG-13/R13 → PG-13, everything else G).
 */
import { describe, expect, it } from 'vitest'
import { ratingOf, type RatingSource } from '../src/client/WallpaperPanel.tsx'

const item = (title: string, contentrating: RatingSource['contentrating'] = null): RatingSource => ({ title, contentrating })

describe('ratingOf', () => {
  it('projects the official content rating onto G / PG-13 / R18', () => {
    expect(ratingOf(item('Customizable Module Visualizer', 'Everyone'))).toBe('G')
    expect(ratingOf(item('Noshiro - Azur Lane', 'Questionable'))).toBe('PG-13')
    expect(ratingOf(item('naizi 高清重置无圣光版', 'Mature'))).toBe('R18')
  })

  it('never lets title markers override the official content rating', () => {
    expect(ratingOf(item('[R18] 碧蓝航线 4K', 'Everyone'))).toBe('G')
    expect(ratingOf(item('[4K/动态/R-18] 樫野', 'Questionable'))).toBe('PG-13')
    expect(ratingOf(item('R-18 wallpaper', 'Everyone'))).toBe('G')
  })

  it('falls back to title markers without an official rating', () => {
    expect(ratingOf(item('R18 lower'))).toBe('R18')
    expect(ratingOf(item('[R-18] 樫野'))).toBe('R18')
    expect(ratingOf(item('(搬运)MMD ヒバナ(R13)'))).toBe('PG-13')
    expect(ratingOf(item('PG-13 test'))).toBe('PG-13')
    expect(ratingOf(item('NSFW Elf Girls Animated'))).toBe('R18')
    expect(ratingOf(item('hentai 合集'))).toBe('R18')
  })

  it('labels unmarked entries G (all-ages)', () => {
    expect(ratingOf(item('碧蓝航线 4K 动态壁纸'))).toBe('G')
    expect(ratingOf(item('Tokyo night rain'))).toBe('G')
    expect(ratingOf(item('Dream wallpaper'))).toBe('G')
    expect(ratingOf(item(''))).toBe('G')
  })
})
