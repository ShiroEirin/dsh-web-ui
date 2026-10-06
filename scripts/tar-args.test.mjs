/**
 * The tar `--force-local` contract (Windows is two different programs behind one
 * name): GNU tar needs the flag to read a `C:\...` argument as a local path,
 * while the bsdtar that Windows ships as `tar.exe` rejects it outright. The flag
 * must follow the binary, not the platform, or every tar call in the release
 * helpers aborts on a stock Windows host.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import { TAR_LOCAL, tarLocalArgs } from './tar-args.cjs'

test('sends no GNU-only flag off Windows', () => {
  assert.deepEqual(tarLocalArgs({ platform: 'linux', accepts: () => true }), [])
  assert.deepEqual(tarLocalArgs({ platform: 'darwin', accepts: () => true }), [])
})

test('sends --force-local on Windows only to a tar that accepts it', () => {
  assert.deepEqual(tarLocalArgs({ platform: 'win32', accepts: () => true }), ['--force-local'])
  // bsdtar answers `Option --force-local is not supported`; the flag must not
  // reach it, and its absence is correct because bsdtar reads drive-letter
  // paths as local without the flag
  assert.deepEqual(tarLocalArgs({ platform: 'win32', accepts: () => false }), [])
})

test('the resolved flag is one the tar in PATH really takes', () => {
  // The branches above are injected; this is the real binary on this machine,
  // which is the case the injected branches cannot prove.
  for (const args of [TAR_LOCAL]) {
    assert.ok(args.length <= 1 && (args.length === 0 || args[0] === '--force-local'))
    execFileSync('tar', [...args, '--version'], { stdio: 'ignore' })
  }
})
