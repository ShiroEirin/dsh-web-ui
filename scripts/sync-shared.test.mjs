import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REPO_ROOT, applySync, checkSync, copyEntries, headerFor, renderCopy, stripHeader } from './sync-shared.mjs'

test('header/strip round-trips every file kind', () => {
  for (const file of ['settings-form.ts', 'PluginSettingsCard.tsx', 'settings-card.module.css']) {
    const source = 'export const x = 1' + String.fromCharCode(10)
    const sourceRel = 'shared/client/settings/' + file
    const rendered = renderCopy(source, file, sourceRel)
    assert.ok(rendered.startsWith(headerFor(file, sourceRel)))
    assert.equal(stripHeader(rendered, file, sourceRel), source)
    assert.equal(stripHeader('mangled ' + rendered.slice(10), file, sourceRel), undefined)
  }
})

test('copies cover the settings trio for all consumers plus host and http helpers', () => {
  // Normalize separators: node:path join yields backslashes on Windows, and
  // the copy-count buckets below match on forward slashes.
  const entries = copyEntries().map(entry => ({ ...entry, target: entry.target.replaceAll('\\', '/') }))
  // The total is every generated copy in the manifest; the single-instance
  // guard alone contributes one mount-once.ts per host half (14 today). The
  // buckets below split the same set by target location, and what neither
  // bucket holds is the package-root test setup (6 today) plus the per-package
  // http.ts and console-output.ts copies. The settings bucket is the card trio
  // plus the entry-bound form fallback, the latter one per package whose card
  // binds a family namespace (7 today). Every family panel now renders through
  // the native layout seats, so the panel-mount-core and sidebar-entry-core
  // copies are gone and body-mutations serves the aggregate shell, the usage
  // card and the plugin-manager's list-level update toolbar. run-guarded.ts is
  // not synced here: no in-repo package imports
  // it (the satellite repositories that do carry their own copies), so only the
  // shared source and its spec remain in this repository. The plugin-card seat
  // copy has three consumers: the GitHub extension renders inside the board's
  // own settings card now, so it carries no card of its own.
  // tool-surface.ts adds three copies in host halves (ssh, task-board,
  // task-board-github); they sit at a package root rather than under
  // src/host/, so the bucket below does not claim them.
  assert.equal(entries.length, 110)
  const clientTrio = entries.filter(entry => entry.target.includes('/src/client/'))
  assert.equal(clientTrio.length, 44)
  const hostCopies = entries.filter(entry => entry.target.includes('/src/host/')
    || entry.target.includes('/src/dsh-home.ts')
    || entry.target.includes('/src/mount-once.ts')
    || entry.target.includes('/src/loopback.ts')
    || entry.target.includes('/src/pair-access.ts')
    || entry.target.includes('/src/agent/')
    || entry.target.endsWith('/packages/dsh-task-board/src/http.ts'))
  assert.equal(hostCopies.length, 49)
})

test('checkSync detects drift and applySync repairs it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-shared-test-'))
  try {
    // Fake tree: every shared source the manifest names, plus one consumer copy
    // whose content drifted. The sources are DERIVED from the manifest rather
    // than hand-listed: a hand-written list silently missed
    // shared/host/detached-work.ts when that entry was added, and checkSync
    // then died on ENOENT instead of reporting drift.
    const sourceText = 'export const shared = 1' + String.fromCharCode(10)
    const entries = copyEntries(root)
    for (const entry of entries) {
      await mkdir(dirname(entry.source), { recursive: true })
      await writeFile(entry.source, sourceText)
    }
    const targetDir = join(root, 'packages', 'dsh-task-board', 'src', 'client')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(targetDir, 'settings-form.ts'), renderCopy('export const bad = 2' + String.fromCharCode(10), 'settings-form.ts', 'shared/client/settings/settings-form.ts'))

    // checkSync compares all consumers; the missing files count as drift too.
    const before = await checkSync(root)
    assert.ok(before.some(entry => entry.reason === 'content drifted from shared source'))
    assert.ok(before.some(entry => entry.reason === 'missing'))

    await applySync(root)
    const after = await checkSync(root)
    assert.deepEqual(after, [])
    const fixed = await readFile(join(targetDir, 'settings-form.ts'), 'utf8')
    assert.equal(stripHeader(fixed, 'settings-form.ts', 'shared/client/settings/settings-form.ts'), sourceText)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the live tree is in sync', async () => {
  const drift = await checkSync()
  assert.deepEqual(drift, [])
})