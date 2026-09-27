/**
 * Real-boot harness for the shell contract specs.
 *
 * boot() from the installed host's dsh-app-boot is the authority for the
 * loader semantics the shell leans on (entry states, the transactional entry
 * group, config resolution). It installs process handlers and may exit, so
 * every scenario runs in a CHILD node process which prints one JSON line of
 * verification facts on stdout.
 *
 * A scenario script and its fixtures may use three placeholders: __DIR__ (the
 * scratch scenario directory, where the fixtures land), __PKG__ (this
 * package's built lib/, i.e. the shipped shell artifact) and __HOST__ (the
 * installed host's own @deepseek-ai directory, for the host packages a
 * scenario mounts).
 *
 * The installed host is an optional peer: when no usable dsh-app-boot
 * resolves (a clean CI checkout without the host face), `dshIt` skips with a
 * note — the cordis-level semantics are covered by the unit specs.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Locate the installed host's dsh-app-boot. A candidate counts only when it
 * can load its own host faces: the repository keeps `autoInstallPeers` off, so
 * the copy the SDK graph pulls into the workspace resolves without its peers
 * (dsh-home-paths, cordis-plugin-group, and the rest) and would turn a missing
 * host into red real-boot specs instead of the documented skip.
 */
function resolveHostBoot(): string | null {
  for (const base of [PACKAGE_DIR, join(PACKAGE_DIR, '../..'), '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot']) {
    let candidate: string
    try {
      candidate = require.resolve('@deepseek-ai/dsh-app-boot', { paths: [base] })
    } catch {
      continue
    }
    if (loadsOwnHostFaces(candidate)) return candidate
  }
  return null
}

/** Whether one app-boot copy resolves every non-optional peer it declares. */
function loadsOwnHostFaces(candidate: string): boolean {
  const manifest = JSON.parse(readFileSync(join(dirname(dirname(candidate)), 'package.json'), 'utf8')) as {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const faces = Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => manifest.peerDependenciesMeta?.[name]?.optional !== true)
  return faces.every((name) => {
    try {
      require.resolve(name, { paths: [dirname(candidate)] })
      return true
    } catch {
      return false
    }
  })
}

export const HOST_BOOT = resolveHostBoot()

/** The installed host's own `@deepseek-ai` directory; scenarios mount host packages from it. */
export const HOST_DIR = HOST_BOOT === null ? null : dirname(dirname(dirname(HOST_BOOT)))

/** `it` when a real boot is available, `it.skip` with a note otherwise. */
export const dshIt = HOST_BOOT ? it : it.skip

/** One scenario run: the child's JSON line, or why the child produced none. */
export interface BootRun {
  ok: boolean
  output: string
  error?: string
}

/**
 * Plugin fixtures every scenario can rely on: a start-failing plugin, a healthy
 * one that provides `goodSvc`, and one that provides a `webServer` late (the
 * real web boot's ordering).
 */
export function standardFixtures(): Record<string, string> {
  return {
    'bad.mjs': 'export function apply() { throw new Error("real plugin start boom") }\n',
    'good.mjs': 'export function apply(ctx) { ctx.provide("goodSvc", { ok: true }); globalThis.__GOOD = 1 }\n',
    'late-web.mjs': 'export function apply(ctx) { const regs = []; ctx.provide("webServer", { register: (r) => { regs.push(r.path); globalThis.__REGS = regs; return () => {} } }) }\n',
  }
}

/**
 * Run one scenario script in a child node process.
 * @param script - the scenario body; placeholders __DIR__ / __PKG__ / __HOST__ are substituted.
 * @param fixtures - extra files to write into the scenario directory.
 * @returns the child's JSON facts line, or the failure that replaced it.
 */
export function runBootScript(script: string, fixtures: Record<string, string> = {}): BootRun {
  if (HOST_BOOT === null || HOST_DIR === null) throw new Error('no usable dsh-app-boot was resolved: run dshIt-gated scenarios only')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shell-it-'))
  const withPaths = (source: string): string => source
    .replaceAll('__DIR__', dir)
    .replaceAll('__PKG__', join(PACKAGE_DIR, 'lib'))
    .replaceAll('__HOST__', HOST_DIR)
  for (const [name, content] of Object.entries({ ...standardFixtures(), ...fixtures })) {
    writeFileSync(join(dir, name), withPaths(content))
  }
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  writeFileSync(join(dir, 'scenario.mjs'), withPaths(script))
  try {
    const stdout = execFileSync(process.execPath, [join(dir, 'scenario.mjs')], { encoding: 'utf8', timeout: 30_000 })
    const line = stdout.trim().split('\n').find(l => l.startsWith('{'))
    return { ok: true, output: line ?? '' }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    const line = (e.stdout ?? '').trim().split('\n').find(l => l.startsWith('{'))
    if (line !== undefined) return { ok: true, output: line }
    return { ok: false, output: '', error: (e.stderr ?? String(error)).slice(0, 200) }
  }
}
