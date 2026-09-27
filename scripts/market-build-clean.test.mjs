import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

/** The content sources are fetched into .market-inputs (market-inputs.lock.json). */
const INPUTS = join(ROOT, '.market-inputs')
const hasInputs = existsSync(join(INPUTS, 'skins'))
  && existsSync(join(INPUTS, 'pet'))
  && existsSync(join(INPUTS, 'community'))
  && existsSync(join(INPUTS, 'presets'))
const SKIP_REASON = 'market inputs not fetched; run node scripts/market-fetch-inputs.mjs'

/** Resolve a package the aggregate depends on, the way market-build does. */
function resolveFamilyPackage(specifier) {
  return dirname(require.resolve(specifier + '/package.json', {
    paths: [join(ROOT, 'packages', 'dsh-web-all'), ROOT],
  }))
}
const SKIN_CENTER_DIR = resolveFamilyPackage('@linxin666/dsh-client-ui-skin-center')
const COMMUNITY_DIR = resolveFamilyPackage('@linxin666/dsh-client-ui-community-plugins')

/**
 * Assemble a true clean-checkout fixture: tracking-tree inputs only, no
 * market/shell/dist (the vendored shell build is git-ignored and CI does not
 * rebuild it). market-build --check in such a tree must succeed after the
 * dist was committed by the same sources, and must still reject tampering.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-clean-'))
  const pairs = [
    [join(ROOT, 'scripts', 'market-build'), join(dir, 'scripts', 'market-build')],
    [join(ROOT, 'market', 'src'), join(dir, 'market', 'src')],
    [join(ROOT, 'market', 'editor-picks.json'), join(dir, 'market', 'editor-picks.json')],
    [join(ROOT, 'market', 'dist'), join(dir, 'market', 'dist')],
    // The skin, pet, community-index and preset content is fetched from its
    // own repositories; the fixture mirrors the layout market-build reads at
    // runtime.
    [join(INPUTS, 'skins'), join(dir, '.market-inputs', 'skins')],
    [join(INPUTS, 'pet'), join(dir, '.market-inputs', 'pet')],
    [join(INPUTS, 'community'), join(dir, '.market-inputs', 'community')],
    [join(INPUTS, 'presets'), join(dir, '.market-inputs', 'presets')],
    // Published packages the aggregate depends on. market-build resolves them
    // through the dependency tree; the fixture has no node_modules, so the
    // in-repo fallback paths are populated instead and the package's own
    // dependency tree is linked beside them.
    [join(SKIN_CENTER_DIR, 'lib'), join(dir, 'packages', 'skins', 'skin-center', 'lib')],
    [join(SKIN_CENTER_DIR, 'package.json'), join(dir, 'packages', 'skins', 'skin-center', 'package.json')],
    // The installer source carries MAX_FILES_PER_ASSET; market-build reads the
    // cap from it to reject catalog assets the installer could not install.
    [join(ROOT, 'packages', 'dsh-market', 'src', 'core', 'installer.ts'), join(dir, 'packages', 'dsh-market', 'src', 'core', 'installer.ts')],
  ]
  for (const [from, to] of pairs) {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
  }
  // Resolve the skin-center lib imports exactly as a pnpm checkout would.
  // A workspace link keeps its dependencies inside the package; a registry
  // install keeps them beside it in the pnpm store.
  symlinkSync(
    existsSync(join(SKIN_CENTER_DIR, 'node_modules'))
      ? join(SKIN_CENTER_DIR, 'node_modules')
      : dirname(dirname(SKIN_CENTER_DIR)),
    join(dir, 'packages', 'skins', 'skin-center', 'node_modules'),
  )
  return dir
}

function runCheck(dir) {
  return spawnSync(process.execPath, ['scripts/market-build', '--check'], { cwd: dir, encoding: 'utf8' })
}

test('clean checkout (no shell dist) passes market-build --check', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = fixture()
  try {
    const result = runCheck(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /dist up to date/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check refuses tampered tryon-assets output', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = fixture()
  try {
    appendFileSync(join(dir, 'market', 'dist', 'tryon-assets', 'skins', 'blue-fantasy', 'skin.css'), '\ntampered{}')
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /tryon-assets\/skins\/blue-fantasy\/skin\.css/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check rejects an editor pick that names a missing catalog asset', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = fixture()
  try {
    writeFileSync(join(dir, 'market', 'editor-picks.json'),
      JSON.stringify({ items: [{ kind: 'skin', id: 'no-such-skin' }] }))
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /editor picks #0: skin:no-such-skin is not in the skin catalog/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check rejects an editor pick outside the skin / pet / plugin kinds', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = fixture()
  try {
    writeFileSync(join(dir, 'market', 'editor-picks.json'),
      JSON.stringify({ items: [{ kind: 'preset', id: 'demo' }] }))
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /editor picks #0: kind must be one of skin \/ pet \/ plugin/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check rejects undeclared files inside the committed tryon dir', (t) => {
  if (!hasInputs) return t.skip(SKIP_REASON)
  const dir = fixture()
  try {
    writeFileSync(join(dir, 'market', 'dist', 'tryon', 'rogue.js'), 'rogue')
    const result = runCheck(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /extra: rogue\.js/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
