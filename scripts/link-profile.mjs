#!/usr/bin/env node
/**
 * Link every dsh-web family plugin into the dsh profile's global
 * @linxin666 namespace (~/.dsh/profiles/node_modules/@linxin666).
 *
 * The dsh loader resolves plugin rows (cordis.patch.yml `name:` entries) by
 * Node package resolution from the profile directory, which walks up through
 * ~/.dsh/profiles/node_modules — the layer where the official dsh packages
 * live. Plugins installed through `dsh plugin add` land in the profile's own
 * node_modules and resolve fine; the family links here make the same
 * resolution work for the aggregate bundles (web-ui-all / dsh-skins) whose
 * children are transitively resolved, and repair links left over from older
 * manual setups.
 *
 * The three satellite repositories under satellites/ are linked the same way.
 * The aggregate mounts them as external rows. The profile-layer link wins for
 * profile-level rows, but the aggregate's own dependency links (pnpm store
 * tarballs) would still win for the rows the aggregate's patch contributes, so
 * those links are repointed at the local checkouts too when a built satellite
 * satisfies the declared range (see decideAggregateRelink). Their lib/ has to
 * exist: `pnpm install` inside a satellite builds it through its prepare
 * script.
 *
 * Idempotent and safe to rerun: stale links pointing elsewhere are replaced,
 * new packages are added, unrelated entries are left untouched. Real files or
 * directories at a link path are never removed — they are reported and
 * skipped.
 *
 * Usage:
 *   node scripts/link-profile.mjs            # link/refresh the family
 *   node scripts/link-profile.mjs --dry-run  # report without changing
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(SCRIPT_DIR, '..')
const require = createRequire(import.meta.url)

/**
 * Pure decision logic for one link path: what should the caller do with the
 * entry currently sitting at the link path? No filesystem access, so it can
 * be unit-tested directly (see scripts/link-profile.test.mjs).
 *
 * @param {'missing'|'symlink'|'file'|'dir'} existing kind of entry at the link path
 * @param {string} target desired relative symlink target
 * @param {string|null} currentTarget current readlink() value, or null when
 *   the entry is not a symlink (or its link target could not be read)
 * @returns {'create'|'keep'|'replace'|'skip-report'}
 */
export function decideLinkAction(existing, target, currentTarget) {
  if (existing === 'missing') return 'create'
  if (existing === 'symlink') {
    return currentTarget === target ? 'keep' : 'replace'
  }
  // Real file or directory: never unlink it, just report and leave it alone.
  return 'skip-report'
}

function report(msg) {
  console.log(`[link-profile] ${msg}`)
}

/** Family packages publish under this scope; everything else under packages/ is not ours to link. */
const FAMILY_SCOPE = '@linxin666/'

/** Every family package: packages/* that has a package.json with a name. */
function familyPackages() {
  const found = []
  for (const { dir, pkgPath } of walkFamilyPackages(REPO_ROOT)) {
    let name
    try { name = JSON.parse(readFileSync(pkgPath, 'utf8')).name } catch { continue }
    if (name && name.startsWith(FAMILY_SCOPE)) {
      found.push({ name: name.slice(FAMILY_SCOPE.length), dir })
    }
  }
  return found
}

/**
 * The satellite packages: satellites/<repo>/ that publish under the family
 * scope. They are not part of this repository's release —
 * family-packages.mjs only walks packages/ — but they are rows in the
 * aggregate, so a built local checkout has to be linked here like the
 * in-repo family.
 */
export function satellitePackages(root = REPO_ROOT) {
  const base = join(root, 'satellites')
  if (!existsSync(base)) return []
  const found = []
  for (const entry of readdirSync(base).sort()) {
    const dir = join(base, entry)
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    let name
    try { name = JSON.parse(readFileSync(pkgPath, 'utf8')).name } catch { continue }
    if (name && name.startsWith(FAMILY_SCOPE)) {
      found.push({ name: name.slice(FAMILY_SCOPE.length), dir })
    }
  }
  return found
}

/**
 * Repair the aggregate's family-scope dependency links that pnpm resolved to
 * registry tarballs when a built satellite checkout exists locally.
 *
 * The aggregate depends on the satellite packages by semver range, so
 * pnpm install links them into its node_modules from the store. The desktop
 * host resolves the aggregate's external plugin rows from the aggregate's
 * own node_modules, which means an edit inside satellites/<repo> never
 * reaches the running GUI until a version is published. When the local
 * checkout carries the satellite with a built lib/, repoint the symlink at
 * it — the same choice the profile-layer links above make. Only existing
 * pnpm-store symlinks are replaced; a real file or directory is never
 * touched, and the satellite must satisfy the declared semver range so the
 * link stays version-consistent.
 */
export function decideAggregateRelink(existing, currentTarget, satelliteDir, declaredRange) {
  if (existing !== 'symlink') return 'skip-report'
  if (!/node_modules\/\.pnpm\//.test(currentTarget ?? '')) return 'keep'
  const pkgPath = join(satelliteDir, 'package.json')
  if (!existsSync(pkgPath) || !existsSync(join(satelliteDir, 'lib', 'index.js'))) return 'skip-report'
  let version
  try { version = JSON.parse(readFileSync(pkgPath, 'utf8')).version } catch { return 'skip-report' }
  if (typeof version !== 'string' || !satifies(version, declaredRange)) return 'skip-report'
  return 'replace'
}

/**
 * Minimal semver caret/tilde/x-range/exact satisfaction for the relink guard.
 * Covers the range shapes the aggregate declares ('^0.4.2', '||' alternations,
 * exact pins); prerelease suffixes compare by their release core, which is the
 * pragmatic choice for a local-checkout link guard.
 */
function satifies(version, range) {
  if (typeof range !== 'string' || range.length === 0) return false
  const parse = (v) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10))
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1
    }
    return 0
  }
  const gte = (a, b) => cmp(a, b) >= 0
  const lt = (a, b) => cmp(a, b) < 0
  const bump = (base, index) => base.map((n, i) => (i === index ? n + 1 : 0))
  const v = parse(version)
  if (v.length !== 3 || v.some((n) => Number.isNaN(n))) return false
  return range.split('||').map((s) => s.trim()).filter(Boolean).some((part) => {
    if (part.startsWith('^')) {
      // ^1.2.3 -> [2,0,0); ^0.4.2 -> [0,5,0); ^0.0.3 -> [0,0,4)
      const base = parse(part.slice(1))
      const upper = bump(base, base[0] > 0 ? 0 : base[1] > 0 ? 1 : 2)
      return gte(v, base) && lt(v, upper)
    }
    if (part.startsWith('~')) {
      const base = parse(part.slice(1))
      return gte(v, base) && lt(v, bump(base, 1))
    }
    if (/^[x*X]$/.test(part)) return true
    const xRange = part.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/)
    if (xRange !== null) {
      const groups = xRange.slice(1)
      const base = groups.map((n) => (n === undefined || /[xX*]/.test(n) ? 0 : parseInt(n, 10)))
      const firstX = groups.findIndex((n) => n === undefined || /[xX*]/.test(n))
      return gte(v, base) && lt(v, bump(base, firstX === -1 ? 2 : firstX))
    }
    return cmp(v, parse(part)) === 0
  })
}

/** Replace pnpm-store links in the aggregate's node_modules with local satellites. */
function relinkAggregateSatellites(DRY) {
  const aggregateNm = join(REPO_ROOT, 'packages', 'dsh-web-all', 'node_modules', FAMILY_SCOPE)
  if (!existsSync(aggregateNm)) return 0
  const satellites = satellitePackages()
  const pkgJson = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-all', 'package.json'), 'utf8'))
  const deps = pkgJson.dependencies || {}
  let changed = 0
  for (const { name, dir } of satellites) {
    if (deps['@linxin666/' + name] === undefined) continue
    const linkPath = join(aggregateNm, name)
    let existing = 'missing'
    let current = null
    try {
      const st = lstatSync(linkPath)
      existing = st.isSymbolicLink() ? 'symlink' : 'other'
      if (existing === 'symlink') {
        try { current = readlinkSync(linkPath) } catch {}
      }
    } catch {}
    const action = decideAggregateRelink(existing, current, dir, deps['@linxin666/' + name])
    if (action !== 'replace') continue
    if (DRY) {
      report(`would relink aggregate ${name} -> ${relative(aggregateNm, dir)}`)
    } else {
      unlinkSync(linkPath)
      symlinkSync(relative(aggregateNm, dir), linkPath)
      report(`relinked aggregate ${name} -> ${relative(aggregateNm, dir)} (was a pnpm store link)`)
    }
    changed++
  }
  if (changed > 0) {
    report(`${changed} aggregate link(s) ${DRY ? 'would be ' : ''}updated`)
  }
  return changed
}

/** External non-family dependencies an aggregate package declares as bundled plugin rows. */
function externalPackages() {
  const dshWebUiAllDir = join(REPO_ROOT, 'packages', 'dsh-web-all')
  const pkgJsonPath = join(dshWebUiAllDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return []
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const deps = pkgJson.dependencies || {}
  const externals = []
  for (const name of Object.keys(deps)) {
    if (name.startsWith(FAMILY_SCOPE)) continue
    try {
      const entryPkg = resolvePath(dirname(require.resolve(`${name}/package.json`, { paths: [dshWebUiAllDir] })))
      const realDir = realpathSync(entryPkg)
      externals.push({ fullName: name, dir: realDir })
      // Aggregate patch rows can come from a bundle's cordis.patch.yml. A
      // bundle-only package (dsh.bundle.patch, no importable entry) cannot be
      // loaded by the loader itself, but the rows it inserts name its child
      // packages, so those children must also resolve from the profile root.
      const bundleManifest = JSON.parse(readFileSync(join(realDir, 'package.json'), 'utf8'))
      const bundlePatch = bundleManifest.dsh?.bundle?.patch
      if (typeof bundlePatch !== 'string') continue
      const patchPath = join(realDir, bundlePatch)
      if (!existsSync(patchPath)) continue
      for (const line of readFileSync(patchPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*name:\s*['"]([^'"]+)['"]\s*$/) || line.match(/^\s*name:\s*(\S+)\s*$/)
        if (!match) continue
        const childName = match[1]
        if (childName.startsWith(FAMILY_SCOPE) || externals.some((e) => e.fullName === childName)) continue
        try {
          const childPkg = resolvePath(dirname(require.resolve(`${childName}/package.json`, { paths: [realDir] })))
          externals.push({ fullName: childName, dir: realpathSync(childPkg) })
        } catch {}
      }
    } catch {}
  }
  return externals
}

/** Parse package names referenced by an external bundle's patch rows. */
export function bundlePatchChildNames(patchText) {
  const names = []
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\s*name:\s*['"]([^'"]+)['"]\s*$/) || line.match(/^\s*name:\s*(\S+)\s*$/)
    if (match) names.push(match[1])
  }
  return names
}

function main() {
  const DRY = process.argv.includes('--dry-run')

  const HOME = process.env.HOME || homedir()
  if (!HOME) {
    report('cannot determine home directory (HOME is unset and os.homedir() is empty)')
    process.exit(1)
  }
  const PROFILES_NM = join(HOME, '.dsh', 'profiles', 'node_modules')
  const LINK_DIR = join(PROFILES_NM, FAMILY_SCOPE)

  const packages = familyPackages()
  const satellites = satellitePackages()
  report(`found ${packages.length} family package(s) under packages/`)
  if (satellites.length) report(`found ${satellites.length} satellite package(s) under satellites/`)
  packages.push(...satellites)
  if (DRY) report('--dry-run: no changes will be made')

  if (!existsSync(LINK_DIR)) {
    if (DRY) {
      report(`would create link dir: ${LINK_DIR}`)
      process.exit(0)
    }
    mkdirSync(LINK_DIR, { recursive: true })
    report(`created link dir: ${LINK_DIR}`)
  }

  let changed = 0
  for (const { name, dir } of packages) {
    const linkPath = join(LINK_DIR, name)
    // Windows without Developer Mode cannot create symlinks (EPERM), so this
    // machine uses directory junctions instead. Junctions require absolute
    // targets and readlink reports the absolute target, so the keep-check
    // compares against that same absolute value on win32.
    const WIN32 = process.platform === 'win32'
    const target = WIN32 ? dir : relative(LINK_DIR, dir) // keep links relative, like the official ones
    let existing = 'missing'
    let linkIsJunctionDir = false
    try {
      const st = lstatSync(linkPath)
      existing = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file'
      // Windows junctions report as both a symlink and a directory under lstat.
      if (existing === 'symlink' && st.isDirectory()) linkIsJunctionDir = true
    } catch {}
    let current = null
    if (existing === 'symlink') {
      try { current = readlinkSync(linkPath) } catch {}
    }
    const action = decideLinkAction(existing, target, current)
    if (action === 'keep') continue // already correct
    if (action === 'skip-report') {
      if (DRY) {
        report(`would skip ${name} (not a symlink)`)
      } else {
        report(`skipped (not a symlink, untouched): ${linkPath}`)
      }
      continue
    }
    if (action === 'create') {
      if (DRY) { report(`would link ${name} -> ${target}`); changed++; continue }
      symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
      report(`linked ${name} -> ${target}`)
    } else {
      if (DRY) { report(`would replace ${name} -> ${current ?? '(broken)'}`); changed++; continue }
      // Windows junctions are directory reparse points; unlink EPERMs, so rmdir.
      if (linkIsJunctionDir) rmdirSync(linkPath)
      else unlinkSync(linkPath)
      symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
      report(`replaced ${name} -> ${target} (was ${current ?? '(broken)'})`)
    }
    changed++
  }

  // Report stale family links (pointing outside this repo) so the user can
  // clean them by hand if needed.
  const stale = []
  for (const entry of readdirSync(LINK_DIR)) {
    const linkPath = join(LINK_DIR, entry)
    let target
    try { target = readlinkSync(linkPath) } catch { continue }
    const abs = resolvePath(LINK_DIR, target)
    const known = packages.some((p) => p.name === entry)
    if (known) continue
    if (abs.startsWith(REPO_ROOT)) continue
    stale.push({ entry, target })
  }
  if (stale.length) {
    for (const s of stale) report(`stale (untouched): ${s.entry} -> ${s.target}`)
  }

  report(changed === 0 ? 'nothing to do' : `${changed} link(s) ${DRY ? 'would be ' : ''}updated`)

  // Also link the external dependencies dsh-web-all declares as bundled plugin rows
  const extPkgs = externalPackages()
  if (extPkgs.length) {
    report(`found ${extPkgs.length} external package(s) from dsh-web-all`)
    let extChanged = 0
    for (const { fullName, dir } of extPkgs) {
      const linkPath = join(PROFILES_NM, fullName)
      const parentDir = dirname(linkPath)
      if (!existsSync(parentDir)) {
        if (!DRY) mkdirSync(parentDir, { recursive: true })
      }
      const WIN32 = process.platform === 'win32'
      const target = WIN32 ? dir : relative(parentDir, dir)
      let existing = 'missing'
      let linkIsJunctionDir = false
      try {
        const st = lstatSync(linkPath)
        existing = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file'
        if (existing === 'symlink' && st.isDirectory()) linkIsJunctionDir = true
      } catch {}
      let current = null
      if (existing === 'symlink') {
        try { current = readlinkSync(linkPath) } catch {}
      }
      const action = decideLinkAction(existing, target, current)
      if (action === 'keep') continue
      if (action === 'skip-report') {
        report(`skipped external (not a symlink, untouched): ${linkPath}`)
        continue
      }
      if (action === 'create') {
        if (DRY) { report(`would link external ${fullName} -> ${target}`); extChanged++; continue }
        symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
        report(`linked external ${fullName} -> ${target}`)
      } else {
        if (DRY) { report(`would replace external ${fullName} -> ${current ?? '(broken)'}`); extChanged++; continue }
        if (linkIsJunctionDir) rmdirSync(linkPath)
        else unlinkSync(linkPath)
        symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
        report(`replaced external ${fullName} -> ${target} (was ${current ?? '(broken)'})`)
      }
      extChanged++
    }
    if (extChanged > 0) {
      report(`${extChanged} external link(s) ${DRY ? 'would be ' : ''}updated`)
    }
  }

  // Keep the aggregate's satellite rows on the local checkouts, so satellite
  // edits reach the running GUI without a release (see decideAggregateRelink).
  relinkAggregateSatellites(DRY)
}

// Run only when invoked as the entry script, so the module can be imported
// (e.g. by the unit tests) without touching the real profile.
if (resolvePath(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main()
}
