# Agent Note: plugin-manager gateway resolves the launched Desktop profile

Status: implemented

## Problem

The third-party plugin page in the packaged Desktop client failed every
"check for updates" with `plugin-manager: gateway
api/plugin-manager/check-updates failed: HTTP 404`.

The browser half picked the gateway channel (the Desktop host publishes no
official `/plugin-installer` RPC channel over HTTP; live probe answers 404),
so it called this package's own loopback gateway at
`/api/plugin-manager/check-updates` — and nothing was mounted there. Live
evidence against the running host bound to `127.0.0.1:19387`: an
authenticated `GET /api/dsh-web-all/rows` answered 200 with the family rows
(including `@linxin666/dsh-client-ui-plugin-manager`), sibling family routes
answered 200, and every `/api/plugin-manager/*` path answered `404 not
found`. The host half had returned before registering a single route.

Cause: `resolveProfile()` resolved the boot profile from `--profile`,
`DSH_PROFILE`, the `web` subcommand, and the packaged app's persisted
selection. The Desktop launcher boots the running profile through
`runProfile({ profile: 'desktop' })` with NONE of those: its argv is
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
<profileDir>, …]` and no `DSH_PROFILE` is exported (both verified with
`ps eww`). `resolveProfile()` threw `plugin-manager: cannot determine the
boot profile`, `applyImpl` logged it and returned, and the gateway stayed
unmounted for the whole process lifetime while the family row kept rendering
its update block.

## Decision

The launched profile the official runtime publishes on the host context —
`profileContext` (`{ name, dir, patchPath, installAnchor, … }`) — is a
resolution fact for the gateway, exactly as
[remote-web-ui's LAN bind](../2026-09-25-remote-web-ui-desktop-lan-bind-profile.md)
already treats it:

- `resolveProfile(argv, env, launched?, desktopLauncher?)` in
  `src/host/profile.ts` gains the launched facts and the precedence explicit
  `--profile` flag, then the published profile, then the profile directory the
  packaged launcher carries in its own argv, then `DSH_PROFILE`, then the
  `web` subcommand, then the persisted Desktop selection, then a loud throw.
  The argv fact exists because Electron strips exec switches from
  `process.argv`: the desktop host sees
  `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, …]` and
  passes that same positional directory to its own profile loader. It is a
  launcher fact independent of the service, so a runtime that publishes no
  `profileContext` still mounts the gateway instead of 404ing, and it
  outranks the environment for the same reason the published profile does.
  The launched facts outrank `DSH_PROFILE` because in this runtime the
  variable is an OUTPUT, not a boot selector: `runProfile()` is the single
  launch path for CLI and Desktop alike and provides `profileContext` in both,
  while `@deepseek-ai/dsh-shell-env` DERIVES `DSH_PROFILE` from
  `profileContext.name` for the shell children it spawns, and no runtime
  module reads it to choose a profile. When both exist they name the same
  profile and the service carries the more precise facts; the one case the
  order settles is a stale or hand-set value that disagrees with the running
  host, where following the variable would mount a gateway whose writes never
  reach the profile the host reads (the hazard
  [remote-web-ui's note](../2026-09-25-remote-web-ui-desktop-lan-bind-profile.md)
  records).
  The published `dir` is used as the profile root — it is the same directory the
  runtime hands its own profile loader — so the gateway reads and writes the
  files the running host uses instead of rebuilding a path from `DSH_HOME`. A
  name-only service still rebuilds `$DSH_HOME/profiles/<name>`.
- The published facts are validated as foreign input rather than trusted because
  they come from the official runtime. The `name`, which drives every
  `dsh plugin --profile <name>` spawn, must be exactly one directory segment:
  separators, `..`, `.` and the empty string are rejected (`.` matters because
  `join` normalizes it away, which would resolve to the `profiles` directory
  itself). The `dir`, which roots every read and the row write, must be an
  absolute path whose RAW segments contain no `..` and whose basename equals
  the published name, so the filesystem half and the CLI half cannot name
  different profiles. The published `patchPath` — a write target — is accepted
  only when it equals `<dir>/cordis.patch.yml`; otherwise the profile's own
  patch file is derived from the directory.
- The resolver's guard bounds the shape of a name or directory, not the scope of
  a location: a published directory anywhere outside this DSH home is still
  accepted at resolve time. The scope check that matters is the mount gate in
  `src/index.ts`, which requires the resolved directory to hold a `package.json`
  before the gateway registers anything, so a foreign location without an
  initialized profile stays dormant.
- `src/index.ts` reads the service through an OPTIONAL `ctx.get('profileContext')`
  (no new injected dependency, the same shape
  `@linxin666/dsh-remote-web-ui` uses) and falls back to argv and the
  environment when a host publishes nothing.
- `isPackagedDesktopArgv(argv)` marks the run as desktop when argv names the
  `@deepseek-ai/dsh-desktop-host` entry script — strictly a launcher fact: a
  profile that merely happens to be *named* `desktop` is not evidence about the
  host, so the name no longer implies it. That keeps `/mode` answering
  `{ official: null }` on the packaged app — where the installer services are
  registered in-process and a CLI boot dump cannot see them — so the browser
  half performs its direct capability probe before falling back to the
  gateway. CLI and container profiles keep their previous behaviour: no
  published service, argv and environment decide, and `desktop` stays false.

The dual-channel split, the route table, the wire shapes, and the loopback
fence are unchanged; `LaunchedProfile` is a contract observation, not an
import, exactly like the official installer wire shapes this package already
mirrors.

## Alternatives considered

- **Make the Desktop launcher pass `--profile` or export `DSH_PROFILE`.**
  Rejected: that launcher is an official component outside this repository,
  and the runtime already publishes the resolved profile for every host shape.
- **Let `DSH_PROFILE` keep priority over the launched facts** (the order the
  original task description assumed). Rejected on evidence: the variable is not
  a boot selector in this runtime. `runProfile()` provides `profileContext` for
  CLI hosts too, `@deepseek-ai/dsh-shell-env` writes `DSH_PROFILE` FROM
  `profileContext.name`, and a scan of the packaged runtime finds no module that
  reads it to choose a profile. Preferring it would therefore never pick a
  different profile on a coherent host, and on an incoherent one it would mount
  the gateway — and write enablement rows — into a profile the running host
  never reads. `--profile` stays above both as the operator override, and the
  variable keeps its full fallback role when no service and no launcher fact
  name a profile.
- **Fall back to the persisted Desktop selection
  (`desktopSelectedProfile()`) before the published service.** Rejected: that
  helper reads `<appData>/DSH Desktop/profile-selection/state.json`, a
  different store from the running host's answer, and this host's location
  carries no such file at all (verified: the packaged app's user-data
  directory holds no `profile-selection` entry). The published service is the
  running profile rather than a guess about it.
- **Require the profile name as a plugin config field.** Rejected: it moves a
  launcher fact onto the user, and a wrong value silently edits a profile that
  is not running — the exact failure mode the remote-web-ui note records.
- **Keep the name-based path builder and only take the name from the
  service.** Rejected: the published `dir` is the launched profile's own fact
  (the runtime passes the same directory to its own profile loader), and the
  gateway's writes and CLI `--profile` arguments must land on the profile the
  running host reads. The name-only fallback stays for a service that publishes
  no directory.
- **Use the published `patchPath` verbatim.** Rejected: it is a write target,
  so a foreign value would let the gateway's row writes escape the profile it
  mounts. The profile's own patch file is derived from the validated directory
  instead, and a published path that disagrees is refused loudly rather than
  silently ignored.
- **Treat a profile named `desktop` as the desktop host.** Rejected: the name
  is not evidence about the host shape, and marking it desktop suspends
  `/mode`'s real installer-service probe on a CLI host that merely uses that
  name. Only the launcher fact (or the persisted desktop selection) marks it.

## Consequences

- The packaged Desktop client mounts the whole gateway route table
  (`list`, `install`, `update`, `remove`, `status`, `set-enabled`,
  `failures`, `mode`, `check-updates`), so the update block on an installed
  plugin's page reaches the registry instead of failing with a 404.
- `facts.profileDir` comes from the host's own launch facts on Desktop, so
  the enablement write and the CLI probes target `profiles/desktop` even when
  the app's persisted selection store is absent or names another profile.
  `facts.patchPath` is always that directory's own `cordis.patch.yml`.
- A host that publishes no `profileContext` and passes no launcher fact still
  stays dormant instead of mounting against a guessed profile: mounting the
  gateway on the wrong profile would edit files the running host never reads.
- The change takes effect on the next host start — the host half is a built
  `lib/index.js` loaded once at boot — so the packaged app must be restarted
  for the Desktop client to pick it up.

## Testing

- `tests/desktop-launch-profile.spec.ts` pins the resolution: the packaged
  Desktop argv with the published service resolves every fact from it, a
  name-only service rebuilds the platform layout, the explicit flag and the
  environment still names the profile when nothing is published, the published
  profile outranks a stale exported `DSH_PROFILE` on any host, a profile merely
  named `desktop` does not mark the run as desktop, an ordinary argv with
  nothing published and no variable still throws, a published traversal name is
  rejected, a published directory that is relative or contains `..` is
  rejected, and a published patch path that is not the profile's own
  `cordis.patch.yml` is rejected. `desktopProfileDirFromArgv` reads the profile
  directory from a packaged launch and reports nothing for an ordinary CLI argv. `desktopProfileDirFromArgv` reads the profile
  directory from a packaged launch and reports nothing for an ordinary CLI argv.
- `tests/host-apply-desktop.spec.ts` is the regression test for the 404: it
  drives the real `apply()` on the packaged Desktop argv with a context that
  provides only `webServer`, and asserts all nine gateway routes are registered
  both when the runtime publishes `profileContext` and when it publishes
  nothing - the latter resolved from the launcher argv alone, which is the
  profileContext-free desktop case. Both positive cases fail against the
  pre-fix source; the dormant case and the uninitialized-profile case are the
  negative controls.
- Live evidence with the built artifact: driving `lib/index.js` with the argv
  captured from the running host and its published profile facts registers all
  nine routes; `GET /api/plugin-manager/check-updates` answers 200 with the
  two real pending updates (`@eddyskywalker/dsh-chatgpt-subscription` 0.8.2 to
  0.8.5 and `dsh-llm-verifier` 0.8.4 to 0.8.6), and `/api/plugin-manager/mode`
  answers `{"official":null}`.