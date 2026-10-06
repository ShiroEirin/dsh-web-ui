# Agent Note: plugin-manager installs and removals on an application-owned profile

Status: implemented

## Problem

On the packaged Desktop client (the DeepSeek Harness Electron app, profile
`desktop`), the Workshop store's one-click install of a community plugin
failed with `安装失败：error: profile "desktop" is managed exclusively by the
Electron application`.

Live evidence from the running host (pid 63705, argv
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
/Users/zcl/.dsh/profiles/desktop, …/primary-runtime, …/pnpm.mjs, …/bin]`):

- `GET /api/plugin-manager/mode` answers `{"official":null}`: the desktop fact
  is set, so the browser half falls back to this package's loopback gateway —
  the Desktop host publishes no official `/plugin-installer` RPC channel.
- The store card calls the `pluginManager` cordis service's `install(spec)`,
  which reaches `POST /api/plugin-manager/install` and then
  `CliGateway.install()` — and that method spawned
  `dsh plugin --profile desktop add <spec>`, which the official launcher's
  `rejectElectronProfile()` refuses before pnpm starts.
- `CliGateway.update()` had already routed an application-owned profile
  through the official in-process manager
  ([the update-path note](2026-09-26-plugin-manager-app-owned-update-path.md));
  install and remove still took the CLI unconditionally.

## Decision

`CliGateway.install()` and `CliGateway.remove()` use the same writer
selection `update()` uses: when `facts.desktop` is true and the host
publishes the official in-process manager on the `pluginManager` service, the
job runs through `installBundle(spec, { enabled: true, requestId })` /
`removeBundle(name)` instead of spawning the CLI. `NativePluginManager` gains
`removeBundle(name)` as one more contract observation (never an import).

Verification mirrors the CLI path, because a green manager call is not proof
the profile moved: an install is only `done` once the profile carries a
dependency it did not carry before, and a removal is only `done` once a
dependency it carried is gone. A manager that resolved without changing the
profile is `安装未生效` / `卸载未生效`; a rejected run resolves too — the
manager's `change()` wrapper folds it into the returned verdict
(`application: 'failed'` / `'cancelled'`, `error.code`, `error.diagnostic`) —
so `nativeManagerFailure()` reads that verdict first and reports its own reason
(`官方插件管理器安装失败：…` / `卸载失败：…`, including the pnpm diagnostic)
before the profile verification runs, exactly as on the update path. The job
table, `/status` polling, the mutation queue and the browser half's wire
contract are unchanged, so the Workshop store and the check-for-updates block
cannot tell the writers apart.

Because the CLI is not the writer there, the gateway's HTTP install, update and
removal routes ask which writer serves the request
(`CliGateway.usesNativeWriter()`) and demand a `dsh` binary only when the CLI
is the one that will actually run: on a packaged Desktop host whose PATH carries
no `dsh` the previous guard answered 500 `dsh CLI not found on PATH` before the
official manager could be asked. An application-owned profile whose host mounts
no manager still fails closed with that same 500.

The CLI-specific guards (duplicate-mount stripping, insert-row resolution, the
`--dump-config` preflight, rollback through the CLI remove path) stay with the
CLI writer: they compensate for the CLI's bundle reconciliation, while the
official manager validates and applies the bundle itself — the same division
the update path already records. On every other runtime, including the
npm-published web runtime, the CLI remains the single writer of installs,
updates and removals.

## Alternatives considered

- **Fix only the store card.** The card already asks the `pluginManager`
  service for the install; the refusal comes from the host writer it routes to,
  so a client-side change would either duplicate the official manager's job or
  leave the same refusal for every other consumer of the service.
- **Make the Desktop host publish an official `/plugin-installer` RPC
  channel.** The launcher and the host are official components outside this
  repository, and the gateway must work for a host that publishes nothing.
- **Route every runtime through the official manager whenever one is mounted.**
  Already rejected in [the update-path note](2026-09-26-plugin-manager-app-owned-update-path.md):
  on the npm web runtime the CLI path is what carries the reconciliation
  guards. Only an application-owned profile, where the CLI refuses to write at
  all, takes the native writer.
- **Run pnpm directly from the gateway for app-owned profiles.** Rejected for
  the same reason as before: it duplicates the official manager's registry
  planning, lock, bundle activation and build-script approval.

## Consequences

- The Workshop store's one-click install, and every other family consumer of
  `pluginManager.install()` / `uninstall()`, works on the packaged Desktop
  client: the job reports `done` with the installed row and the next host start
  loads the plugin.
- The gateway's own guards do not run on the native install/removal path; the
  official manager owns validation, pnpm invocation, the profile lock and
  bundle activation there, and this gateway re-reads the profile afterwards.
- Legacy-aggregate migration stays CLI-only and therefore still meets the
  launcher refusal on an application-owned profile. It is a targeted repair for
  `@linxin666/dsh-web-ui-all`, whose multi-step flow (CLI reconciliation
  guards, bundles reordering, dump-config preflight, rollback) has no desktop
  evidence behind it today.
- The change takes effect on the next host start: the host half is a built
  `lib/index.js` loaded at boot.
- The Workshop store stopped routing its installs through this gateway at all:
  it now calls the official manager's own remote face and hands management to
  the official Plugins page
  ([reuse note](../architecture/2026-09-27-workshop-store-reuses-official-plugin-surfaces.md)).
  This gateway path stays as the fallback for family consumers and for hosts
  that publish no remote.

## Testing

- `tests/native-writer-route.spec.ts`: on an application-owned profile whose
  host mounts the manager and exposes no CLI, the install, update and removal
  routes all answer 200 with a job; on an ordinary profile — and on a desktop
  profile whose host mounts no manager — they keep the 500
  `dsh CLI not found on PATH`.
- `tests/gateway-jobs.spec.ts`: on a `desktop` fact set an install runs
  through a scripted official manager and the CLI spawn seam throws if it is
  ever used; a manager failure settles the job as an error with the manager's
  message; a folded failure verdict on an install or a removal is reported with
  its own reason instead of the `安装未生效` / `卸载未生效` no-op text; a green
  manager run that added no dependency is `安装未生效`; a removal runs through
  `removeBundle` and the dependency leaves the profile; a green removal that
  left the dependency is `卸载未生效`; and on a non-desktop profile the CLI
  stays the writer for install and removal with the manager untouched. The
  native update tests from the previous note keep passing.
- The writer the fix routes to is verified live in the running profile: the
  official manager keeps its own operation logs under
  `~/.dsh/profiles/desktop/.plugin-manager/logs/`, and they show it writing
  this profile in-process — `operation-rXQHkp/pnpm.log` (2026-09-27) added
  `dsh-better-sidebar ^0.21.1`, `operation-uy6dkO` (2026-09-24) added
  `dsh-web link:/Users/zcl/code/dsh-web`, and `operation-pA7jAh` added
  `dsh-llm-verifier`. The path is therefore proven to work where the CLI is
  refused; what stays unverified is only this gateway's own run of it, which
  needs the restarted packaged host the repository forbids an agent to restart.
  A live probe of the same host also confirms the channel gap the fix covers:
  `GET` on `/plugin-installer` and `/plugin-control` answers 404 (the 405 a
  `POST` returns is the web server's generic unknown-path answer — `/zzz-nope`
  answers the same), so the browser half has no official HTTP channel to fall
  back on and the gateway is its write path.
