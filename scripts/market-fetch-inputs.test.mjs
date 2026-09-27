/**
 * market-fetch-inputs contract: the submodule gitlink is the only pin, an
 * input is "ok" only when the pinned commit is materialized, and a check run
 * never downloads. The two materialization paths are covered here against a
 * throwaway checkout; the real repositories are exercised by the deploy lane.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  GITMODULES,
  REPO_ROOT,
  cacheDir,
  fetchInput,
  githubSlug,
  loadLockfile,
  parseGitmodules,
  planInputs,
  readStamp,
  resolveSources,
  stampPath,
  submodulePin,
  tarballUrl,
} from './market-fetch-inputs.mjs'

const SHA = 'a'.repeat(40)
const SUBMODULE = 'satellites/dsh-skins'

/** Run git in a fixture; a fixture that cannot run git is a broken test. */
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function commit(dir, message) {
  git(['add', '.'], dir)
  git([
    '-c', 'user.email=fixture@example.com',
    '-c', 'user.name=fixture',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', message,
  ], dir)
}

function fixtureLock(inputs, version = 2) {
  const root = mkdtempSync(join(tmpdir(), 'market-inputs-lock-'))
  writeFileSync(join(root, 'market-inputs.lock.json'), JSON.stringify({ version, inputs }))
  return root
}

/**
 * A throwaway checkout carrying one submodule: the outer repository records
 * the gitlink, and the submodule is a real checkout of the commit it names, so
 * pin resolution runs against git instead of a stand-in.
 */
function fixtureCheckout() {
  const root = mkdtempSync(join(tmpdir(), 'market-inputs-checkout-'))
  git(['-c', 'init.defaultBranch=main', 'init', '-q'], root)
  const inner = join(root, SUBMODULE)
  mkdirSync(join(inner, 'skins'), { recursive: true })
  writeFileSync(join(inner, 'skins', 'skin.json'), '{}\n')
  git(['-c', 'init.defaultBranch=main', 'init', '-q'], inner)
  commit(inner, 'fixture')
  const sha = git(['rev-parse', 'HEAD'], inner)
  writeFileSync(
    join(root, GITMODULES),
    `[submodule "${SUBMODULE}"]\n\tpath = ${SUBMODULE}\n\turl = https://github.com/zhu1090093659/dsh-skins.git\n`,
  )
  git(['update-index', '--add', '--cacheinfo', `160000,${sha},${SUBMODULE}`], root)
  return { root, inner, sha }
}

function fixtureLockObject(inputs) {
  return { version: 2, inputs }
}

const GOOD = { skins: { submodule: SUBMODULE, path: 'skins', target: 'skins' } }
/** A resolved pin, the shape resolveSources produces for one input. */
const SOURCE = { sha: SHA, expected: SHA, repo: 'zhu1090093659/dsh-skins', worktree: null }

test('loadLockfile accepts a well-formed lockfile', () => {
  const root = fixtureLock(GOOD)
  try {
    const lock = loadLockfile(root)
    assert.equal(lock.inputs.skins.submodule, SUBMODULE)
    assert.equal(lock.inputs.skins.path, 'skins')
    assert.equal(lock.inputs.skins.target, 'skins')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadLockfile rejects a missing key, an escaping path and an unknown version', () => {
  const cases = [
    [{ skins: { path: 'skins', target: 'skins' } }, /missing a string "submodule"/],
    [{ skins: { ...GOOD.skins, submodule: '../escape' } }, /invalid submodule path/],
    [{ skins: { ...GOOD.skins, path: '../escape' } }, /unsafe path/],
  ]
  for (const [inputs, expected] of cases) {
    const root = fixtureLock(inputs)
    try {
      assert.throws(() => loadLockfile(root), expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  const stale = fixtureLock(GOOD, 1)
  try {
    assert.throws(() => loadLockfile(stale), /unsupported version 1/)
  } finally {
    rmSync(stale, { recursive: true, force: true })
  }
})

test('parseGitmodules maps every fully declared submodule path to its URL', () => {
  const parsed = parseGitmodules([
    '# comment',
    '[submodule "satellites/dsh-skins"]',
    '\tpath = satellites/dsh-skins',
    '\turl = https://github.com/zhu1090093659/dsh-skins.git',
    '[submodule "satellites/dsh-pet"]',
    '\turl = https://github.com/zhu1090093659/dsh-pet.git',
    '\tpath = satellites/dsh-pet',
    '[submodule "half-declared"]',
    '\tpath = satellites/unused',
  ].join('\n'))
  assert.equal(parsed.get('satellites/dsh-skins'), 'https://github.com/zhu1090093659/dsh-skins.git')
  assert.equal(parsed.get('satellites/dsh-pet'), 'https://github.com/zhu1090093659/dsh-pet.git')
  assert.equal(parsed.has('satellites/unused'), false)
})

test('githubSlug reduces https and ssh GitHub URLs to owner/name', () => {
  assert.equal(githubSlug('https://github.com/zhu1090093659/dsh-skins.git'), 'zhu1090093659/dsh-skins')
  assert.equal(githubSlug('https://github.com/zhu1090093659/dsh-skins'), 'zhu1090093659/dsh-skins')
  assert.equal(githubSlug('git@github.com:zhu1090093659/dsh-pet.git'), 'zhu1090093659/dsh-pet')
  assert.throws(() => githubSlug('https://gitlab.com/zhu1090093659/dsh-pet.git'), /not a GitHub repository URL/)
})

test('submodulePin reads the commit the checkout records for the submodule', () => {
  const fixture = fixtureCheckout()
  try {
    assert.equal(submodulePin(fixture.root, SUBMODULE), fixture.sha)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('submodulePin reports a path with no gitlink instead of guessing a commit', () => {
  const fixture = fixtureCheckout()
  try {
    assert.throws(() => submodulePin(fixture.root, 'satellites/absent'), /carries no gitlink/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('resolveSources pins the gitlink and adopts a working tree sitting on it', () => {
  const fixture = fixtureCheckout()
  try {
    const sources = resolveSources(fixtureLockObject(GOOD), fixture.root)
    assert.deepEqual(sources.skins, {
      submodule: SUBMODULE,
      sha: fixture.sha,
      repo: 'zhu1090093659/dsh-skins',
      worktree: join(fixture.root, SUBMODULE, 'skins'),
      head: fixture.sha,
      expected: fixture.sha,
    })
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('resolveSources falls back to the pinned commit when the working tree left the pin', () => {
  const fixture = fixtureCheckout()
  try {
    writeFileSync(join(fixture.inner, 'skins', 'later.json'), '{}\n')
    commit(fixture.inner, 'moved on')
    const moved = git(['rev-parse', 'HEAD'], fixture.inner)
    const sources = resolveSources(fixtureLockObject(GOOD), fixture.root)
    assert.equal(sources.skins.sha, fixture.sha)
    assert.equal(sources.skins.head, moved)
    assert.equal(sources.skins.expected, fixture.sha)
    assert.equal(sources.skins.worktree, null)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('resolveSources --local reads a working tree that left the pin', () => {
  const fixture = fixtureCheckout()
  try {
    writeFileSync(join(fixture.inner, 'skins', 'later.json'), '{}\n')
    commit(fixture.inner, 'moved on')
    const moved = git(['rev-parse', 'HEAD'], fixture.inner)
    const sources = resolveSources(fixtureLockObject(GOOD), fixture.root, undefined, { local: true })
    assert.equal(sources.skins.sha, fixture.sha)
    assert.equal(sources.skins.expected, moved)
    assert.equal(sources.skins.worktree, join(fixture.root, SUBMODULE, 'skins'))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('resolveSources refuses an input whose submodule .gitmodules never declares', () => {
  const fixture = fixtureCheckout()
  try {
    const lock = fixtureLockObject({ skins: { ...GOOD.skins, submodule: 'satellites/dsh-absent' } })
    assert.throws(() => resolveSources(lock, fixture.root), /does not declare/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('the committed lockfile only names submodules .gitmodules declares', () => {
  const lock = loadLockfile(REPO_ROOT)
  const modules = parseGitmodules(readFileSync(join(REPO_ROOT, GITMODULES), 'utf8'))
  const declared = Object.values(lock.inputs).map(input => githubSlug(modules.get(input.submodule)))
  assert.deepEqual(declared, [
    'zhu1090093659/dsh-skins',
    'zhu1090093659/dsh-pet',
    'zhu1090093659/dsh-community-plugins',
    'zhu1090093659/dsh-presets',
  ])
})

test('planInputs reports missing, stale and ok against the cache stamp', () => {
  const cache = mkdtempSync(join(tmpdir(), 'market-inputs-cache-'))
  try {
    const lock = fixtureLockObject(GOOD)
    const sources = { skins: SOURCE }
    assert.equal(planInputs(lock, cache, { sources })[0].state, 'missing')

    // A stamp for a different commit with content on disk is stale, not ok.
    mkdirSync(join(cache, 'skins'), { recursive: true })
    writeFileSync(stampPath(cache, 'skins'), `${'b'.repeat(40)}\n`)
    assert.equal(planInputs(lock, cache, { sources })[0].state, 'stale')

    writeFileSync(stampPath(cache, 'skins'), `${SHA}\n`)
    const planned = planInputs(lock, cache, { sources })[0]
    assert.equal(planned.state, 'ok')
    assert.equal(planned.dir, join(cache, 'skins'))
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})

test('planInputs reads the stamp against the commit the source yields, not the pin', () => {
  const cache = mkdtempSync(join(tmpdir(), 'market-inputs-local-'))
  const branchSha = 'c'.repeat(40)
  try {
    const sources = {
      skins: { sha: SHA, expected: branchSha, repo: 'zhu1090093659/dsh-skins', worktree: '/local/skins' },
    }
    mkdirSync(join(cache, 'skins'), { recursive: true })

    // The cache holds the pinned commit, so a run that reads a working tree is stale.
    writeFileSync(stampPath(cache, 'skins'), `${SHA}\n`)
    assert.equal(planInputs(fixtureLockObject(GOOD), cache, { sources })[0].state, 'stale')

    writeFileSync(stampPath(cache, 'skins'), `${branchSha}\n`)
    const planned = planInputs(fixtureLockObject(GOOD), cache, { sources })[0]
    assert.equal(planned.state, 'ok')
    assert.equal(planned.sha, SHA)
    assert.equal(planned.expected, branchSha)
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})

test('planInputs honours the only filter', () => {
  const lock = fixtureLockObject({
    skins: GOOD.skins,
    pet: { submodule: 'satellites/dsh-pet', path: 'assets', target: 'pet' },
  })
  const sources = { pet: { sha: SHA, expected: SHA, repo: 'zhu1090093659/dsh-pet', worktree: null } }
  const names = planInputs(lock, '/nonexistent-cache', { sources, only: ['pet'] }).map(input => input.name)
  assert.deepEqual(names, ['pet'])
})

test('planInputs refuses an input whose commit was never resolved', () => {
  assert.throws(() => planInputs(fixtureLockObject(GOOD), '/nonexistent-cache', { sources: {} }), /no commit to read/)
})

test('fetchInput materializes content out of the submodule working tree', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'market-inputs-copy-'))
  const worktree = mkdtempSync(join(tmpdir(), 'market-inputs-worktree-'))
  try {
    writeFileSync(join(worktree, 'skin.json'), '{"id":"blue-fantasy"}\n')
    writeFileSync(join(worktree, '.git'), 'gitdir: ../../.git/modules/dsh-skins\n')
    await fetchInput({
      name: 'skins',
      submodule: SUBMODULE,
      path: 'skins',
      target: 'skins',
      sha: SHA,
      expected: SHA,
      repo: 'zhu1090093659/dsh-skins',
      worktree,
      dir: join(cache, 'skins'),
    }, cache)
    assert.equal(readFileSync(join(cache, 'skins', 'skin.json'), 'utf8'), '{"id":"blue-fantasy"}\n')
    assert.equal(existsSync(join(cache, 'skins', '.git')), false)
    assert.equal(readStamp(cache, 'skins'), SHA)
  } finally {
    rmSync(cache, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  }
})

test('fetchInput stamps the commit it read, so local content is not recorded as the pin', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'market-inputs-local-copy-'))
  const worktree = mkdtempSync(join(tmpdir(), 'market-inputs-local-worktree-'))
  const branchSha = 'd'.repeat(40)
  try {
    writeFileSync(join(worktree, 'skin.json'), '{"id":"work-in-progress"}\n')
    await fetchInput({
      name: 'skins',
      submodule: SUBMODULE,
      path: 'skins',
      target: 'skins',
      sha: SHA,
      expected: branchSha,
      repo: 'zhu1090093659/dsh-skins',
      worktree,
      dir: join(cache, 'skins'),
    }, cache)
    assert.equal(readStamp(cache, 'skins'), branchSha)
    assert.equal(readFileSync(join(cache, 'skins', 'skin.json'), 'utf8'), '{"id":"work-in-progress"}\n')
  } finally {
    rmSync(cache, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  }
})

test('readStamp returns null when nothing was unpacked', () => {
  const cache = mkdtempSync(join(tmpdir(), 'market-inputs-empty-'))
  try {
    assert.equal(readStamp(cache, 'skins'), null)
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})

test('cacheDir prefers MARKET_INPUTS_DIR and otherwise sits at the repository root', () => {
  assert.match(cacheDir({ MARKET_INPUTS_DIR: '/tmp/custom-inputs' }), /custom-inputs$/)
  assert.match(cacheDir({}), /[.]market-inputs$/)
})

test('tarballUrl addresses the codeload tarball for the pinned commit', () => {
  assert.equal(
    tarballUrl('owner/dsh-skins', SHA),
    `https://codeload.github.com/owner/dsh-skins/tar.gz/${SHA}`,
  )
})
