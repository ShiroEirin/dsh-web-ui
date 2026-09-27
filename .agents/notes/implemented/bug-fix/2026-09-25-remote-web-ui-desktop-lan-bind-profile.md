# Agent Note: remote-web-ui LAN bind targets the launched profile

Status: implemented

## Problem

The LAN access toggle writes the managed webserver block into
`<profile>/cordis.patch.yml`, and it resolved which profile that is from
`config.profile ?? process.env.DSH_PROFILE ?? 'web'`. The `dsh` CLI exports
`DSH_PROFILE`, so `dsh web` deployments worked. The DSH Desktop client does
not: it boots the `desktop` profile through
`runProfile({ profile: 'desktop', args: ['--no-open', '--port', '19387'] })`
and never sets the environment variable, so the plugin resolved `web` and wrote
the block into `$DSH_HOME/profiles/web/cordis.patch.yml` while the running host
read `profiles/desktop`.

Reported symptom: turning on 局域网访问 in the Desktop client's settings card
never exposed the GUI on the LAN. The card kept reporting that a restart was
pending, the running bind stayed `127.0.0.1`, and the panel kept showing
"此功能需要局域网绑定或公网地址才能使用" — the phone stayed locked out.

The official runtime publishes the launched profile on the host context as
`profileContext` (`{ name, dir, patchPath, installAnchor, … }`): the same
service `@deepseek-ai/dsh-base` branches on
(`ctx.get('profileContext')?.name === 'desktop'`) and
`@deepseek-ai/dsh-shell-env` reads to fill `DSH_PROFILE`.
`dsh-desktop-host` provides it with `name: "desktop"`.

## Decision

- `resolveManagedProfile(configured, launched, env)` in `lan-bind-plan.ts`
  owns the precedence: an explicit `profile` config, then the launched profile
  the Host published, then `DSH_PROFILE`, then `web`. It is a pure helper so
  the boot path and the settings/status path share one implementation and unit
  coverage pins the order.
- `index.ts` reads the runtime fact once per activation
  (`launchedProfileName(ctx)`) and feeds it into the resolved config.
- The Desktop client therefore manages `profiles/desktop/cordis.patch.yml`,
  which is the file its host actually reads. CLI and container deployments keep
  their previous behaviour: with no published service the environment still
  decides.

## Alternatives considered

- **Make the Desktop client export `DSH_PROFILE`.** Rejected: that is an
  official launcher outside this repository's ownership, and the runtime already
  carries the fact for every host shape.
- **Require users to fill in the `profile` field.** Rejected: the field is an
  override, and the default has to be right for the common case.
- **Resolve the patch file from `profileContext.patchPath` instead of the
  name.** Rejected for now: the name-based path builder's containment guard and
  the `$DSH_HOME/profiles/<name>` layout are already covered by tests, and
  adopting the service path is a larger change with no behavioural gain while
  the resolver's own home is the source of truth.

## Consequences

- Desktop users can turn LAN access on and have the bind apply at the next
  start; `pendingRestart` clears after that start instead of staying set
  forever.
- The relay identity is per profile
  (`$DSH_HOME/remote-web-ui-registry/<profile>.json`), so a Desktop client no
  longer shares the `web` profile's registered origin.
- A hand-written user patch row replaces a row's whole `config` object: a row
  that sets `lanBind: true` must restate the aggregate shell's
  `plugin: '@linxin666/dsh-remote-web-ui'`, or the family shell has no import
  target and that row degrades (the settings card writes the full config, so
  in-GUI edits are unaffected).

## Testing

- `tests/lan-bind-plan.spec.ts`: the explicit config wins over the launched
  profile and the environment; the launched profile wins over a stale
  `DSH_PROFILE` (the Desktop case); the environment, then `web`, are the
  remaining fallbacks.
- Live evidence: the Desktop host bound to `127.0.0.1:19387` answered
  `GET /api/pair/lan-bind` with `"profile":"web"` before the fix; the same
  endpoint reports `desktop` once the launched profile is read.
