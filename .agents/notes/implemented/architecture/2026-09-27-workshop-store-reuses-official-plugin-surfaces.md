# Agent Note: Workshop store reuses the official plugin surfaces

Status: implemented

## Problem

The Workshop store card installed community plugins through a writer chain of
its own: the family `pluginManager` cordis service
(`@linxin666/dsh-client-ui-plugin-manager`) → that package's loopback gateway →
the official `dsh plugin` CLI. On the packaged Desktop client the CLI refuses
the application-owned profile (`error: profile "desktop" is managed exclusively
by the Electron application`), so one-click install failed with exactly that
message, while the official Plugins page — which drives the in-process manager
over `ctx.remote.pluginManager` — kept installing into the same profile (its
own operation logs under
`~/.dsh/profiles/desktop/.plugin-manager/logs/` record those runs).

The official support the store was not using:

- `remote.pluginManager` — the API gateway registers every remote namespace as
  the service `remote.<namespace>`; the official page installs with
  `installBundle(spec, { enabled, requestId, registry, approvedBuilds })`,
  removes with `removeBundle(name)` and toggles with `setBundleEnabled`.
- `pluginNavigation` — the reflect service the official page publishes
  (`openBundle(packageName)`), which opens one bundle's page in its panel.

## Decision

1. **Install through the official remote face when the host publishes it.**
   The card calls `ctx.remote.pluginManager.installBundle(spec, { enabled: true,
   requestId })` and surfaces the gateway's `{ ok, value | error }` envelope as
   the card's own install error. The family `pluginManager` face stays the
   fallback writer for hosts that publish no remote, and the copy-command index
   stays the degradation when neither exists.
2. **Management stays in the official container.** An installed entry exposes a
   manage action that calls `pluginNavigation.openBundle(packageName)`, opening
   the bundle's page in the official Plugins panel: enablement, uninstall and
   the install diagnostics stream already live there and are not re-implemented
   in the store. The action renders only while that service is bridged.
3. **Both faces are optional and bridged with `ctx.inject`** (never the
   plugin's module-level `inject` array), exactly like the family
   `pluginManager` bridge, so a host that publishes neither face keeps the
   store card fully rendered.
4. **The two faces are contract observations.** No cross-package value import:
   the members the store calls (and the remote result envelope) are re-declared
   in `src/client/native-plugin-faces.ts`, the same discipline the family
   bridge already applies to `PluginManagerService`.

## Alternatives considered

- **Keep the family gateway as the store's only install path.** The host half
  already routes an application-owned profile to the in-process manager
  ([the install-path note](../bug-fix/2026-09-27-plugin-manager-app-owned-install-path.md)),
  so this was sufficient for the reported failure. Rejected as the store's path:
  it keeps a second writer for a job the official manager already performs, has
  to relax the gateway's CLI gate, and cannot offer the official install
  diagnostics. That host-side route stays as the fallback for family consumers
  (the check-for-updates block) and for hosts without the remote.
- **Re-implement uninstall, enablement and progress in the store card.**
  Rejected: it duplicates the official container, including its confirmation and
  progress semantics, which the repository rules say to keep as the base.
- **Require `remote.pluginManager` in the plugin's `inject` array.** Rejected:
  the whole store card would silently disappear on a host that publishes no
  remote, taking the catalog, likes and asset installs with it.
- **Use the official `pluginInventory` for the installed snapshot as well.**
  Deferred: the family face already answers that question from the profile the
  host reads, and the card's matcher is keyed to that row shape. Only the
  install writer had to move to fix the failure.

## Consequences

- One-click install works on the packaged Desktop client: the click drives the
  official manager, no CLI is spawned for it, and the bundle is activated for
  the next start (`enabled: true`).
- The store no longer needs the family face to install; that bridge remains for
  the installed snapshot and as the fallback writer.
- Skins, pets and presets are unchanged: they have no official counterpart and
  keep the market's own `api/market/install-*` gateway.
- The client half is inlined into the aggregate, so an aggregate install must be
  rebuilt (`pnpm build` + `node scripts/lib-artifact-check.mjs --write`) for the
  change to reach the served bundle.

## Testing

- `packages/dsh-market/tests/market-card.spec.tsx`: with the official remote
  face injected, the install click calls `installBundle` with the entry's spec
  and `{ enabled: true }` and never the family writer; a manager refusal is what
  the card reports; an installed entry's manage action calls `openBundle` with
  the installed package name.
- `packages/dsh-market/src/client/install-source.test.ts`: `managePackageName`
  addresses the installed row id, strips a version/tag suffix from the declared
  npm name, and falls back to the entry id.
- `packages/dsh-market/tests/client-apply.spec.tsx`: `apply()` exercises the
  optional-face bridge with a context that publishes neither face, and still
  registers exactly one settings section.
- `packages/dsh-market/tests/native-plugin-faces.spec.ts`: the optional bridge
  is exercised on a REAL cordis context — providing `remote.pluginManager` and
  `pluginNavigation` populates the store under exactly those dotted service
  names, and withdrawing them clears it again — so the injection mechanism this
  reuse depends on is verified rather than assumed.
- Verified live end to end on the running packaged Desktop host (the very
  host this change was written for), by driving the real GUI over the DevTools
  protocol with the app's own session cookie:
  1. `设置 → 创意工坊 → 插件` rendered the store card; an installed plugin's row
     showed the new manage action, which only renders when `pluginNavigation`
     was bridged — so the running host publishes the official surfaces.
  2. Clicking 一键安装 on 免费搜索 created the profile dependency
     `dsh-free-search ^0.4.39` and a NEW official-manager operation log
     (`operation-NjSgmD/pnpm.log`, pnpm v11.7.0) — the install was performed by
     the official in-process manager, not the CLI, and the card flipped to
     已安装 + 在插件页管理.
  3. Clicking 在插件页管理 opened that bundle's page in the official Plugins
     panel (dsh-free-search v0.4.39, 卸载 available).
  4. `卸载` + its confirmation removed the bundle through the same official
     manager, and the profile returned to exactly its pre-test dependency set
     (`@eddyskywalker/dsh-chatgpt-subscription`, `dsh-better-sidebar`,
     `dsh-llm-verifier`, `dsh-web`).
  The test plugin was uninstalled again after the run, so the verification left
  no residue. What the API gateway's own registration rule — every remote
  namespace becomes the service named `remote.<namespace>` — plus this run also
  settle is that the card never needed the family writer on this host; should a
  host publish none of it, the card degrades to the family face and to the
  host-side native writer fixed in the install-path note.
