/**
 * Tests for the root alias release contract (issue #1442): the root bundle's
 * dependency is the release-line caret on the released aggregate version,
 * because a spec that can keep resolving an aggregate older than the shipped
 * patch mounts rows the installed aggregate cannot export, and the root's own
 * version must follow the tag because a git or link install reports it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rootAggregatePinMismatch, rootVersionMismatch } from './lib/root-alias-pin.mjs'

const manifest = spec => ({ dependencies: { '@linxin666/dsh-web-all': spec } })

test('accepts the release-line caret on the tag version', () => {
  assert.equal(rootAggregatePinMismatch(manifest('^0.3.20'), '0.3.20'), undefined)
})

test('rejects an exact pin, a trailing base, a wider range, and a missing dependency', () => {
  assert.match(rootAggregatePinMismatch(manifest('0.3.20'), '0.3.20'), /expected \^0\.3\.20/)
  assert.match(rootAggregatePinMismatch(manifest('^0.3.19'), '0.3.20'), /\^0\.3\.19 does not match tag v0\.3\.20/)
  assert.match(rootAggregatePinMismatch(manifest('^0.3.6'), '0.3.20'), /does not match/)
  assert.match(rootAggregatePinMismatch(manifest('~0.3.20'), '0.3.20'), /does not match/)
  assert.match(rootAggregatePinMismatch(manifest('>=0.3.20'), '0.3.20'), /does not match/)
  assert.match(rootAggregatePinMismatch(manifest('*'), '0.3.20'), /does not match/)
  assert.match(rootAggregatePinMismatch({ dependencies: {} }, '0.3.20'), /\(missing\)/)
  assert.match(rootAggregatePinMismatch({}, '0.3.20'), /\(missing\)/)
  assert.match(rootAggregatePinMismatch(null, '0.3.20'), /\(missing\)/)
})

test('accepts a root version equal to the tag version', () => {
  assert.equal(rootVersionMismatch({ version: '0.3.20' }, '0.3.20'), undefined)
})

test('rejects a stale, missing, or unreadable root version', () => {
  assert.match(rootVersionMismatch({ version: '0.1.1' }, '0.3.20'), /root version 0\.1\.1 does not match tag v0\.3\.20/)
  assert.match(rootVersionMismatch({}, '0.3.20'), /root version \(missing\) does not match tag v0\.3\.20/)
  assert.match(rootVersionMismatch(null, '0.3.20'), /\(missing\)/)
})
