/**
 * Unit tests for the link-profile helpers: the pure link-state decision logic,
 * the bundle patch reader, and the satellite package walk.
 *
 * Importing link-profile.mjs must not execute main() (it is guarded by the
 * entry-script check), so these tests never touch the real ~/.dsh profile.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideLinkAction, bundlePatchChildNames, satellitePackages, decideAggregateRelink } from './link-profile.mjs'

const TARGET = '../../dsh-web-ui/packages/dsh-web-ui'

test('missing -> create', () => {
  assert.equal(decideLinkAction('missing', TARGET, null), 'create')
})

test('symlink to target -> keep', () => {
  assert.equal(decideLinkAction('symlink', TARGET, TARGET), 'keep')
})

test('symlink to other -> replace', () => {
  assert.equal(decideLinkAction('symlink', TARGET, '../something-else'), 'replace')
})

test('broken symlink -> replace', () => {
  assert.equal(decideLinkAction('symlink', TARGET, null), 'replace')
})

test('real file -> skip', () => {
  assert.equal(decideLinkAction('file', TARGET, null), 'skip-report')
})

test('real dir -> skip', () => {
  assert.equal(decideLinkAction('dir', TARGET, null), 'skip-report')
})

test('bundle patch child names include scoped and plain plugin rows', () => {
  const patch = `- id: session-persistence-jsonl
  disabled: true

- insert:
    - id: session-rdb
      name: '@morlay/session-rdb'
    - id: ui-conversation-message-actions
      name: '@morlay/ui-conversation-message-actions'
    - id: better-sidebar
      name: 'dsh-better-sidebar'
`
  assert.deepEqual(bundlePatchChildNames(patch), [
    '@morlay/session-rdb',
    '@morlay/ui-conversation-message-actions',
    'dsh-better-sidebar',
  ])
})

test('satellite packages: only family-scoped satellites/* with a readable manifest are collected', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-satellites-'))
  try {
    const write = (name, manifest) => {
      const dir = join(root, 'satellites', name)
      mkdirSync(dir, { recursive: true })
      if (manifest !== null) writeFileSync(join(dir, 'package.json'), manifest)
    }
    write('dsh-pet', JSON.stringify({ name: '@linxin666/dsh-pet' }))
    write('dsh-community-plugins', JSON.stringify({ name: '@linxin666/dsh-client-ui-community-plugins' }))
    write('third-party', JSON.stringify({ name: 'some-other-package' }))
    write('no-manifest', null)
    write('broken-manifest', '{ not json')
    assert.deepEqual(satellitePackages(root).map((p) => p.name), [
      'dsh-client-ui-community-plugins',
      'dsh-pet',
    ])
    assert.equal(satellitePackages(join(root, 'absent')).length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


const STORE_LINK = '../../../../node_modules/.pnpm/@linxin666+dsh-client-ui-skin-center@0.4.2_react@18.3.1/node_modules/@linxin666/dsh-client-ui-skin-center'

test('aggregate relink: replaces a pnpm-store symlink when the satellite is built and in range', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-relink-'))
  try {
    const satellite = join(root, 'satellites', 'dsh-skins')
    mkdirSync(join(satellite, 'lib'), { recursive: true })
    writeFileSync(join(satellite, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-client-ui-skin-center', version: '0.4.2' }))
    writeFileSync(join(satellite, 'lib', 'index.js'), 'export {}')
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2'), 'replace')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('aggregate relink: keeps a link that already points outside the store', () => {
  assert.equal(decideAggregateRelink('symlink', '../../../satellites/dsh-skins', '/nonexistent', '^0.4.2'), 'keep')
})

test('aggregate relink: never touches a real file or directory', () => {
  assert.equal(decideAggregateRelink('file', STORE_LINK, '/nonexistent', '^0.4.2'), 'skip-report')
  assert.equal(decideAggregateRelink('dir', STORE_LINK, '/nonexistent', '^0.4.2'), 'skip-report')
  assert.equal(decideAggregateRelink('missing', null, '/nonexistent', '^0.4.2'), 'skip-report')
})

test('aggregate relink: skips a satellite without a built lib', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-relink-'))
  try {
    const satellite = join(root, 'satellites', 'dsh-skins')
    mkdirSync(satellite, { recursive: true })
    writeFileSync(join(satellite, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-client-ui-skin-center', version: '0.4.2' }))
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2'), 'skip-report')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('aggregate relink: skips a satellite outside the declared range', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-relink-'))
  try {
    const satellite = join(root, 'satellites', 'dsh-skins')
    mkdirSync(join(satellite, 'lib'), { recursive: true })
    writeFileSync(join(satellite, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-client-ui-skin-center', version: '0.5.0' }))
    writeFileSync(join(satellite, 'lib', 'index.js'), 'export {}')
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2'), 'skip-report')
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2 || ^0.5.0'), 'replace')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('aggregate relink: accepts a newer patch satellite under a caret range', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-relink-'))
  try {
    const satellite = join(root, 'satellites', 'dsh-skins')
    mkdirSync(join(satellite, 'lib'), { recursive: true })
    writeFileSync(join(satellite, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-client-ui-skin-center', version: '0.4.3' }))
    writeFileSync(join(satellite, 'lib', 'index.js'), 'export {}')
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2'), 'replace')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('aggregate relink: caret range still rejects the next minor', () => {
  const root = mkdtempSync(join(tmpdir(), 'link-profile-relink-'))
  try {
    const satellite = join(root, 'satellites', 'dsh-skins')
    mkdirSync(join(satellite, 'lib'), { recursive: true })
    writeFileSync(join(satellite, 'package.json'), JSON.stringify({ name: '@linxin666/dsh-client-ui-skin-center', version: '0.5.0' }))
    writeFileSync(join(satellite, 'lib', 'index.js'), 'export {}')
    assert.equal(decideAggregateRelink('symlink', STORE_LINK, satellite, '^0.4.2'), 'skip-report')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
