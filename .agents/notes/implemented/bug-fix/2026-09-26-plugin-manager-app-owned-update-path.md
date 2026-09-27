# Agent Note: plugin-manager updates on an application-owned profile

Status: implemented

## Problem

On the packaged Desktop client (the DeepSeek Harness Electron app, DSH 0.1.7-rc.2
with profile `desktop`), clicking **Update** in this plugin's check-for-updates
block failed with `操作失败：env: node: No such file or directory`.

Live evidence from the running host (pid 72345, argv
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
/Users/zcl/.dsh/profiles/desktop, …]`):

- `ps eww` shows the host environment as `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
  — a GUI-launched process with no node and no homebrew prefix, although
  `ELECTRON_RUN_AS_NODE=1` marks it as an Electron-as-Node host.
- `findDshBinary()` falls through PATH (no `dsh`), through the host-entry
  probes (the packaged runtime's `app.asar` carries no `node_modules/.bin`
  directory and no `dsh-desktop-host/lib/bin.js`), and lands on the darwin
  fallback `/opt/homebrew/bin/dsh` — a symlink to
  `@deepseek-ai/dsh/lib/bin.js` whose first line is `#!/usr/bin/env node`.
- `dshSpawnCommand()` returned that path unchanged off Windows ("bin.js
  carries a node shebang, so POSIX spawns it directly"), so the kernel handed
  the shebang to `/usr/bin/env`, which could not find `node` on the child's
  PATH. Reproduced exactly:
  `env -i PATH=/usr/bin:/bin /opt/homebrew/bin/dsh --version` → exit 127,
  `env: node: No such file or directory`; the gateway surfaces the CLI's raw
  stderr tail as the job error, which is the string the panel rendered.

Two further facts decide the fix:

- Even with a working spawn, the profile cannot be written by the CLI:
  `dsh plugin --profile desktop …` exits 1 with
  `error: profile "desktop" is managed exclusively by the Electron application`
  (`rejectElectronProfile` in the official `dsh` CLI). The packaged launcher
  hands its bundled runtime to the host as launcher facts
  (`packageManager: { command: process.execPath, args: [--expose-internals,
  <runtime>/pnpm/bin/pnpm.mjs], env: { PATH: <runtime>/bin + delimiter + PATH } }`),
  so an application-owned profile is written in-process, not through the CLI.
- That in-process writer exists and is mounted: `@deepseek-ai/dsh-base` inserts
  `id: plugin-manager, name: '@deepseek-ai/dsh-plugin-manager'`, and its class
  extends `TypertRemoteService`, whose constructor is `super(ctx,
  "pluginManager")` — an ordinary Cordis service under the key
  `pluginManager` with the `installBundle` / `removeBundle` methods the
  official Plugins page drives as `ctx.remote.pluginManager`.

## Decision

1. **A Node-script CLI is never spawned through its shebang.** `isNodeScript()`
   classifies a resolved CLI path as a Node script by extension (`.js`,
   `.cjs`, `.mjs`) or by a `#!… node` shebang probe, and
   `dshSpawnCommand()` then runs it under an interpreter that exists without
   PATH: a `node` installed beside the CLI when the installation ships one
   (npm-global and homebrew layouts), otherwise `process.execPath` — the
   Electron host covered by the existing `ELECTRON_RUN_AS_NODE` branch. A
   native executable or a shell wrapper still spawns as-is, and an unreadable
   head falls back to the previous direct spawn.
2. **The CLI's own directory goes first on the child PATH**
   (`withPrependedPath()`, collapsing every case variant of the key into one
   `PATH`, the Windows hazard the desktop childEnv note records). `dsh plugin`
   forwards to pnpm, and npm-global and homebrew installations keep `pnpm`
   beside `dsh`; without this the update would start and then fail on a
   missing pnpm.
3. **An application-owned profile updates through the official in-process
   manager.** `CliGateway` reads `ctx.get('pluginManager')` through a seam the
   host half supplies, and only when `facts.desktop` is true: the official
   manager resolves the registry, runs pnpm with the launcher's bundled
   toolchain and applies the bundle. The job table, `/status` polling, the
   mutation queue and the version verification are unchanged, and the update is
   only `done` after the dependency is still in the profile and reports the
   version the route resolved — a green manager call that moved nothing is a
   `更新未生效` error, exactly like the CLI path. Every other runtime keeps the
   CLI as the single writer, unchanged.

The official manager is a contract observation, not an import: the repository
builds against the official SDK's published packages, and this package must
keep running on a host that mounts no manager. The route stays behind the
loopback fence and the user's click, the same authority the official Plugins
page has when it calls the same service.

## Alternatives considered

- **Fix only the spawn and let the CLI report the refusal.** Rejected: the
  update button would then fail with an English upstream message on the very
  runtime the feature is used from, and DSH will not relax the rule — the
  profile belongs to the app.
- **Route every operation through the official manager whenever it is mounted.**
  Rejected for now: installs and removals on the npm web runtime go through the
  CLI path whose reconciliation guards (duplicate entry ids, unresolvable
  insert rows, duplicate-mount stripping, `--dump-config` preflight) this
  gateway exists to provide, and the official manager enforces its own
  equivalents. Moving them is a separate decision with its own evidence.
- **Run pnpm directly from the gateway for app-owned profiles.** Rejected: it
  duplicates the official manager's job — registry planning, lock, bundle
  activation, build-script approval — against the repository rule that native
  DSH stays the base.
- **Reach the official manager from the browser half through
  `ctx.remote.pluginManager`.** Rejected: the host half runs in the same
  process as the service, so the client hop would add a wire face, an
  `/mode` flag and a third client channel for no benefit.
- **Prepend the app's bundled runtime bin to PATH instead of resolving an
  interpreter.** Rejected: the launcher's PATH fact belongs to the app, its
  directory holds only a `node` launcher shim (no pnpm), and this package must
  work for a CLI-booted host as well.

## Consequences

- A check-for-updates update on the packaged Desktop client works: the job
  reports `done` with the new version row, then the panel shows the restart
  hint. The same spawn fix applies to every other CLI call the gateway makes
  (`--version` probes, installs, removals, migrations) on any GUI-launched
  host.
- The gateway's own guards do not run on the native update path; the official
  manager owns registry resolution, pnpm invocation, the profile lock and
  bundle activation there, and this gateway re-reads the profile afterwards
  for verification.
- The change takes effect on the next host start (the host half is a built
  `lib/index.js` loaded at boot).

## Testing

- `tests/gateway.spec.ts`: `dshSpawnCommand` picks the sibling `node` for a
  `#!/usr/bin/env node` shim and `process.execPath` when none is installed
  beside it, runs a `.js` bin path through the interpreter without probing the
  file, still spawns a native binary and a `#!/bin/sh` wrapper directly, and
  falls back to a direct spawn when the head cannot be read;
  `withPrependedPath` prepends to a POSIX PATH, collapses Windows case
  variants into one key, and writes PATH when the environment carries none.
- `tests/gateway-jobs.spec.ts`: on a `desktop` fact set the update runs
  through a scripted official manager and the CLI spawn seam throws if it is
  ever used; a manager failure settles the job as an error with the manager's
  message; a green manager run that left the version in place is
  `更新未生效`; and on a non-desktop profile the CLI stays the writer with the
  manager untouched.
- Live reproduction of the spawn defect and of its repair against the real
  installation: exit 127 with `env: node: No such file or directory` for the
  old shape, `0.1.7-rc.2` for `/opt/homebrew/bin/node /opt/homebrew/bin/dsh
  --version` under the host's own `PATH=/usr/bin:/bin`, and
  `error: profile "desktop" is managed exclusively by the Electron application`
  once the CLI starts with its directory on PATH.
- Not verified live in this change: the native update run itself needs the
  restarted packaged host, which the repository forbids an agent to restart.
  The evidence that the service exists there is the mounted `dsh-base` row,
  the `super(ctx, "pluginManager")` binding, and the official Plugins page
  this package's section renders inside, which drives the same service.
