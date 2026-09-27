#!/usr/bin/env node
/**
 * market-fetch-inputs - materialize the market's content sources.
 *
 * The market build does not read the skin, pet, community-index or preset
 * content out of this monorepo: it lives in its own repositories (dsh-skins,
 * dsh-pet, dsh-community-plugins, dsh-presets), which this repository carries
 * as git submodules under satellites/. The submodule
 * gitlink is the pin - the commit recorded on this branch is the commit whose
 * content the market serves - and .gitmodules names the repository behind each
 * one. market-inputs.lock.json holds what git cannot express: which submodule
 * carries an input and where its content sits inside it.
 *
 * This script materializes every pinned content directory into
 * MARKET_INPUTS_DIR. A submodule checked out at the pinned commit is copied
 * from, so local edits in that working tree are part of the build input;
 * otherwise the pinned commit is downloaded as a tarball and only its content
 * directory is unpacked, so a clone that never initializes the submodules
 * still builds the same content without fetching history. --local reads the
 * submodule working trees whatever commit they sit on; a market/dist built
 * from what it writes comes from unpinned content and must not be committed.
 *
 * Usage:
 *   node scripts/market-fetch-inputs.mjs              # fetch missing/stale inputs
 *   node scripts/market-fetch-inputs.mjs --check      # verify only, never download
 *   node scripts/market-fetch-inputs.mjs --force      # refetch every input
 *   node scripts/market-fetch-inputs.mjs --only skins # fetch a subset
 *   node scripts/market-fetch-inputs.mjs --local      # read the submodule working trees
 *
 * Environment:
 *   MARKET_INPUTS_DIR   cache directory (default: <repo>/.market-inputs)
 *
 * Exit code is non-zero on any failure: a missing or stale input must never
 * let the market build silently ship a partial catalogue.
 */
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')
export const LOCKFILE = 'market-inputs.lock.json'
export const GITMODULES = '.gitmodules'
const SHA_RE = /^[0-9a-f]{40}$/
/** A submodule path is checkout-relative: plain segments and no empty ones. */
const SUBMODULE_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

/** Reject the two segments that would let a lockfile entry point outside the checkout. */
function isSubmodulePath(value) {
  return SUBMODULE_PATH_RE.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..')
}

/** Records the commit currently unpacked beside the content directory. */
export const STAMP_SUFFIX = '.sha'

/** Cache directory for the unpacked content sources. */
export function cacheDir(env = process.env) {
  return env.MARKET_INPUTS_DIR ? resolve(env.MARKET_INPUTS_DIR) : join(REPO_ROOT, '.market-inputs')
}

/**
 * Read and validate market-inputs.lock.json.
 * @returns {{version: number, inputs: Record<string, {submodule: string, path: string, target: string}>}}
 */
export function loadLockfile(root = REPO_ROOT) {
  const file = join(root, LOCKFILE)
  if (!existsSync(file)) throw new Error(`${LOCKFILE} not found at ${file}`)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (parsed.version !== 2) throw new Error(`${LOCKFILE}: unsupported version ${parsed.version}`)
  const inputs = parsed.inputs
  if (inputs === null || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error(`${LOCKFILE}: "inputs" must be a non-empty object`)
  }
  for (const [name, input] of Object.entries(inputs)) {
    if (input === null || typeof input !== 'object') throw new Error(`${LOCKFILE}: input "${name}" must be an object`)
    for (const key of ['submodule', 'path', 'target']) {
      if (typeof input[key] !== 'string' || input[key] === '') {
        throw new Error(`${LOCKFILE}: input "${name}" is missing a string "${key}"`)
      }
    }
    if (!isSubmodulePath(input.submodule)) {
      throw new Error(`${LOCKFILE}: input "${name}" has an invalid submodule path "${input.submodule}"`)
    }
    if (input.path.startsWith('/') || input.path.includes('..')) {
      throw new Error(`${LOCKFILE}: input "${name}" has an unsafe path "${input.path}"`)
    }
  }
  return parsed
}

/** Path of the stamp recording which commit is unpacked for one input. */
export function stampPath(cache, target) {
  return join(cache, `${target}${STAMP_SUFFIX}`)
}

/** The commit currently unpacked for one input, or null. */
export function readStamp(cache, target) {
  try {
    return readFileSync(stampPath(cache, target), 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Parse .gitmodules into submodule path -> repository URL. Git writes a config
 * file with one [submodule "<name>"] section per submodule; only the `path` and
 * `url` keys matter here.
 */
export function parseGitmodules(text) {
  const byPath = new Map()
  let section = null
  const flush = () => {
    if (section !== null && section.path !== null && section.url !== null) {
      byPath.set(section.path, section.url)
    }
    section = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    if (/^\[submodule\s+".+"\]$/.test(line)) {
      flush()
      section = { path: null, url: null }
      continue
    }
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line)
    if (entry === null || section === null) continue
    if (entry[1] === 'path') section.path = entry[2].trim()
    else if (entry[1] === 'url') section.url = entry[2].trim()
  }
  flush()
  return byPath
}

/** The `owner/name` the codeload tarball endpoint addresses. */
export function githubSlug(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (match === null) {
    throw new Error(`"${url}" is not a GitHub repository URL, so the tarball fallback cannot download it`)
  }
  return `${match[1]}/${match[2]}`
}

/** Run git in a directory and return its trimmed stdout. */
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`git is unavailable: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().split('\n')[0]
    throw new Error(`git ${args.join(' ')} failed${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout.trim()
}

/**
 * The pinned commit of one input: the gitlink this branch records for its
 * submodule. The index is read rather than HEAD so a bump can be verified
 * before it is committed.
 */
export function submodulePin(root, submodule) {
  const entry = git(['ls-files', '-s', '--', submodule], root)
  const match = /^160000 ([0-9a-f]{40}) [0-9]+\t/.exec(entry)
  if (match === null) {
    throw new Error(`${submodule} carries no gitlink in this checkout; restore the submodule pointer before building the market`)
  }
  return match[1]
}

/** The commit a submodule working tree sits on, or null when it is not checked out. */
function submoduleHead(root, submodule) {
  const dir = join(root, submodule)
  if (!existsSync(join(dir, '.git'))) return null
  try {
    return git(['rev-parse', 'HEAD'], dir)
  } catch {
    return null
  }
}

/**
 * Resolve what comes from the checkout rather than the lockfile: each
 * submodule's repository URL (.gitmodules), its pinned commit (the gitlink),
 * and the content source to materialize from. The pinned commit is the source
 * unless `local` asks for whatever the submodule working trees hold, which is
 * how a developer builds the market from an edit in place.
 */
export function resolveSources(lock, root = REPO_ROOT, only, { local = false } = {}) {
  const modules = parseGitmodules(readFileSync(join(root, GITMODULES), 'utf8'))
  const sources = {}
  for (const [name, input] of Object.entries(lock.inputs)) {
    if (only !== undefined && !only.includes(name)) continue
    const url = modules.get(input.submodule)
    if (url === undefined) {
      throw new Error(`input "${name}" names the submodule "${input.submodule}", which ${GITMODULES} does not declare`)
    }
    const sha = submodulePin(root, input.submodule)
    const content = join(root, input.submodule, input.path)
    const head = submoduleHead(root, input.submodule)
    const checkedOut = head !== null && existsSync(content)
    const fromWorktree = checkedOut && (local || head === sha)
    sources[name] = {
      submodule: input.submodule,
      sha,
      repo: githubSlug(url),
      worktree: fromWorktree ? content : null,
      head,
      /** The commit the cache holds once this source is materialized. */
      expected: fromWorktree ? head : sha,
    }
  }
  return sources
}

/**
 * Resolve every input against the cache: "ok" means the source this run is
 * configured for is already materialized and the content directory is present.
 */
export function planInputs(lock, cache, { sources, only } = {}) {
  const plan = []
  for (const [name, input] of Object.entries(lock.inputs)) {
    if (only !== undefined && !only.includes(name)) continue
    const source = sources?.[name]
    if (source === undefined || !SHA_RE.test(source.sha ?? '') || !SHA_RE.test(source.expected ?? '')) {
      throw new Error(`input "${name}" has no commit to read; resolve it from the submodule gitlink`)
    }
    const dir = join(cache, input.target)
    const stamp = readStamp(cache, input.target)
    let state = 'missing'
    if (stamp === source.expected && existsSync(dir)) state = 'ok'
    else if (stamp !== null && stamp !== source.expected) state = 'stale'
    plan.push({
      name,
      ...input,
      sha: source.sha,
      expected: source.expected,
      repo: source.repo,
      worktree: source.worktree ?? null,
      dir,
      stamp,
      state,
    })
  }
  return plan
}

/** Tarball URL for a repository commit (no history, no unrelated blobs). */
export function tarballUrl(repo, sha) {
  return `https://codeload.github.com/${repo}/tar.gz/${sha}`
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} failed: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

/**
 * Materialize one input: copy the content directory out of a submodule working
 * tree that sits on the pinned commit, or download that commit as a tarball and
 * unpack the same directory from it.
 */
export async function fetchInput(input, cache) {
  const work = join(cache, `.work-${input.target}`)
  const tarball = join(work, 'source.tgz')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  try {
    if (input.worktree !== null) {
      rmSync(input.dir, { recursive: true, force: true })
      cpSync(input.worktree, input.dir, { recursive: true, filter: source => basename(source) !== '.git' })
    } else {
      await download(tarballUrl(input.repo, input.sha), tarball)
      const untar = spawnSync('tar', ['-xzf', tarball, '-C', work], { stdio: 'inherit' })
      if (untar.status !== 0) throw new Error(`tar failed for ${input.repo}@${input.sha.slice(0, 9)}`)
      const repoName = input.repo.split('/').pop()
      const unpacked = readdirSync(work).find(entry => entry.startsWith(`${repoName}-`))
      if (unpacked === undefined) throw new Error(`unexpected tarball layout for ${input.repo}`)
      const source = join(work, unpacked, input.path)
      if (!existsSync(source)) {
        throw new Error(`${input.repo}@${input.sha.slice(0, 9)} has no "${input.path}" directory`)
      }
      rmSync(input.dir, { recursive: true, force: true })
      mkdirSync(dirname(input.dir), { recursive: true })
      renameSync(source, input.dir)
    }
    writeFileSync(stampPath(cache, input.target), `${input.expected}\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Fetch every planned input that is not already materialized. */
export async function fetchAll(plan, cache, { force = false, log = console } = {}) {
  const fetched = []
  for (const input of plan) {
    if (input.state === 'ok' && !force) {
      log.log(`[market-inputs] ${input.name}: ${input.expected.slice(0, 9)} already unpacked`)
      continue
    }
    const from = input.worktree === null
      ? `${input.repo}@${input.sha.slice(0, 9)}`
      : `${input.submodule}@${input.expected.slice(0, 9)}`
    log.log(`[market-inputs] ${input.name}: fetching ${from}`)
    await fetchInput(input, cache)
    log.log(`[market-inputs] ${input.name}: unpacked into ${input.dir}`)
    fetched.push(input.name)
  }
  return fetched
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const force = args.includes('--force')
  const local = args.includes('--local')
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex === -1 ? undefined : args.slice(onlyIndex + 1).filter(a => !a.startsWith('--'))
  const cache = cacheDir()

  let lock
  try {
    lock = loadLockfile()
  } catch (error) {
    console.error(`market-fetch-inputs: ${error.message}`)
    process.exit(1)
  }
  if (only !== undefined) {
    const unknown = only.filter(name => !(name in lock.inputs))
    if (unknown.length > 0) {
      console.error(`market-fetch-inputs: unknown input(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
  }

  let plan
  try {
    const sources = resolveSources(lock, REPO_ROOT, only, { local })
    for (const source of Object.values(sources)) {
      if (source.head === null || source.head === source.expected) continue
      console.error(`[market-inputs] ${source.submodule} is checked out at ${source.head.slice(0, 9)}, not the pinned ${source.sha.slice(0, 9)}: this run reads the pinned commit, so the build ignores that working tree (add --local to read it instead)`)
    }
    if (local) {
      console.error(`[market-inputs] local mode: ${cache} will hold the submodule working trees, not the pinned commits, so a market/dist built from it must not be committed`)
    }
    plan = planInputs(lock, cache, { sources, only })
  } catch (error) {
    console.error(`market-fetch-inputs: ${error.message}`)
    process.exit(1)
  }
  if (check) {
    const broken = plan.filter(input => input.state !== 'ok')
    for (const input of plan) {
      const commit = input.expected === input.sha ? input.expected.slice(0, 9) : `${input.expected.slice(0, 9)} (pin ${input.sha.slice(0, 9)})`
      const detail = input.state === 'ok' ? commit : `${input.state} (have ${input.stamp === null ? 'nothing' : input.stamp.slice(0, 9)})`
      console.log(`[market-inputs] ${input.name}: ${detail}`)
    }
    if (broken.length > 0) {
      console.error(`market-fetch-inputs: run "node scripts/market-fetch-inputs.mjs${local ? ' --local' : ''}" first`)
      process.exit(1)
    }
    console.log('[market-inputs] check OK')
    return
  }

  try {
    await fetchAll(plan, cache, { force })
  } catch (error) {
    console.error(`market-fetch-inputs: ${error.message}`)
    process.exit(1)
  }
  console.log(`[market-inputs] ready in ${cache}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main()
}
