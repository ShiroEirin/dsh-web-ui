/**
 * The family package walker: every package.json under packages/, the single
 * package root of this repository. The skin, pet and community packages left
 * for their own repositories, so packages/skins/ no longer exists here.
 * Shared by verify-version, release-assets, verify-docs, and link-profile,
 * which each used to carry their own drifting copy.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * @param {string} root - repository root to walk.
 * @returns {{ dir: string, pkgPath: string }[]} absolute package dirs and
 *   their package.json paths, sorted by directory name.
 */
export function walkFamilyPackages(root) {
  const out = []
  const base = resolve(root, 'packages')
  if (!existsSync(base)) return out
  for (const entry of readdirSync(base).sort()) {
    const dir = resolve(base, entry)
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    out.push({ dir, pkgPath })
  }
  return out
}
