# Agent Note: A family bundle row keeps its own loader id

Status: implemented

## Problem

Loader row ids live in one global id space with one entry per id, later wins, and no diagnostic: `@deepseek-ai/cordis-plugin-loader` builds its entry map with `Object.fromEntries(config.map(options => [options.id ?? Symbol('anonymous'), options]))`. A row that reuses an id another bundle already claims is not rejected — the earlier row is silently dropped, and whatever UI that row's package owns disappears with it.

`@linxin666/dsh-client-ui-plugin-manager` claimed `ui-plugin-manager`, the id the official `@deepseek-ai/dsh-web-app` bundle uses for `@deepseek-ai/dsh-client-ui-plugin-manager`. The two halves are not interchangeable: only the official browser half registers `sidebar.panellist`, the seat that puts the "Plugins" entry in the sidebar, while this package's browser half registers just `plugins.detail.section` on the official Plugins page. Once the official row was dropped, the sidebar entry was gone, the plugin management page was unreachable, and the update-check section lost its host page. Nothing logged the loss, and the read-only plugin list in Settings still rendered, so the profile looked healthy ([#1794](https://github.com/zhu1090093659/dsh-web/issues/1794)).

The install-time guard did not catch it either. `CliGateway.detectDuplicateClaims` builds its taken-id set from the profile patch's own bare rows plus the claimed ids of the profile's DEPENDENCIES, and the official web-app bundle is neither: its rows arrive from the Host's own bundle layer. A family package colliding with an official id was therefore invisible at install time, exactly like the loader row roster is the one surface the SDK cohort scan does not cover.

The obvious fix — give this package a different standalone row id — ran into a second constraint. The aggregate derives every family row id from the child's own row id (`namespaceId`), and the family subpath export is derived from that row id in turn, so renaming the child row also renames the published aggregate row `web-ui-plugin-manager` and its subpath export `@linxin666/dsh-web-all/plugin-manager`. The three ids that would keep the aggregate stable (`plugin-manager`, `ui-plugin-manager`, `web-ui-plugin-manager`) are all taken: the first by the official `@deepseek-ai/dsh-base` bundle, the second by the official web-app bundle. So the requested fix was unsatisfiable while the two id spaces stayed coupled.

## Decision

The standalone row moves into its own namespace, and the aggregate pins the family row it mounts that child under, so no published identifier moves with it.

- This package's standalone row is `ui-plugin-manager-update-check`; the official `ui-plugin-manager` row keeps its own entry, so both plugins mount. The row `name` stays exactly `@linxin666/dsh-client-ui-plugin-manager`: the official `@deepseek-ai/dsh-client-modules` resolves a browser half through the loader row whose specifier resolves to that package's own manifest (`locatePkgJson` compares the nearest `package.json` name to the specifier), so a subpath-shaped name mounts the host half only and leaves the browser section dead.
- The host half's cordis plugin name (`src/index.ts`) follows the row id, and `LOCKED_ENTRY_IDS` carries both the standalone id and the unchanged family id `web-ui-plugin-manager`, so a mounted entry is unambiguous and the manager's escape-hatch lock still covers the rows that perform the write.
- `aggregate.yml` gains a `familyIds:` section mapping a child's own row id to the aggregate row id it is mounted under. `scripts/aggregate.mjs` resolves row ids, family subpaths and the `patches:`/`inactive:` targets through it, defaults to the derived id for every other row, and rejects a dead key, a value outside the `web-ui-*` id space, and any override that collides with another row. The generated patch, the `./plugin-manager` export and the client-children lists come out byte-identical.
- `tests/bundle-row-id.spec.ts` pins this package's three invariants against the shipped files: exactly one insert row named exactly the package name; an id outside a snapshot of the official bundle row roster (both official bundles, not only `ui-*`) and outside every other family package's claimed ids; a host-half plugin name equal to the row id. `scripts/aggregate.test.mjs` pins the family side: every override stays in the aggregate id space, names a mounted row and differs from the child id, and the plugin-manager family row id, subpath and export survive the standalone rename.

No profile migration ships with this. The id comes from the package's own bundle patch, so installing the fixed version re-derives the standalone row, and the aggregate row a profile already knows is untouched.

## Alternatives considered

Renaming only the standalone row and letting the aggregate follow was rejected: it moves two published identifiers for every aggregate install. The family row id is the one a profile's user layer can target, and this repository's own rule for family rows is that their ids stay byte-identical so existing profiles need no migration; a profile that had overridden `web-ui-plugin-manager` would boot with a `patch: entry not found` warning and a row that silently re-enables, and the inventory title would change from `web-all/plugin-manager` to `web-all/plugin-manager-update-check`. Tombstoning the retired subpath would keep the export resolvable but not the row id.

Moving this child from `patchFrom` to the external `rows:` section, which carries an explicit id, was rejected: external rows mount the real package name directly, so the row would lose the fault-isolation shell and its inventory title would change from the family subpath to the package name.

Moving the row out of this package's bundle patch and letting a plain bundle entry mount it under the package name was rejected: the aggregate derives its family row from that insert row, so the family row would disappear with it.

Keeping the id and registering a `sidebar.panellist` seat from this package instead was rejected: the seat belongs to the official plugin page, and a second entry with the same semantics would put two competing "Plugins" entries in the sidebar rather than restore the official one.

Extending the install pre-check to read the Host's own bundle patches and reject a colliding claim was rejected as unverifiable here. Resolving `@deepseek-ai/dsh-web-app/cordis.patch.yml` at runtime couples the gateway to the Host install layout (npm, packaged desktop shell and source checkouts differ), it runs only on the install path and repairs nothing already broken, and the official-id knowledge would then live in two places: the snapshot the test pins and a runtime resolution.

Picking a bare `plugin-manager` standalone id, which would have namespaced straight back to `web-ui-plugin-manager`, was rejected once the full official roster was read: `@deepseek-ai/dsh-base` already claims that id, so it would have traded one silent row loss for another.

Widening the roster gate to every family row in the same change was rejected as a cross-cutting decision that belongs to the aggregate: a DSH release adding an official `ui-market`, say, would turn an unrelated package's suite red and pull the roster into every package's test.

## Consequences

The official sidebar "Plugins" entry and the official plugin management page mount again alongside this package's update-check section, and aggregate installs see no change at all: the family row id, its subpath export and the inventory title are byte-identical.

A profile that had this package installed keeps working, and a profile that disabled the misnamed row through this package's own UI holds a stale `ui-plugin-manager` user-layer override. Include-patch semantics skip a bare override whose `name` does not match the inserted entry's name, and the official row's name is the official package, so that override cannot disable the official entry.

The official roster in the test is a snapshot of the `0.2.0-rc.2` `dsh-base` and `dsh-web-app` bundle patches, not a live read: this repository builds against published SDK packages and does not depend on the Host's bundle tree. A DSH release that introduces a row id colliding with a family row is not caught until the snapshot is refreshed, which is why the refresh instruction sits in the test header and the family rule points at it.

`familyIds:` is a per-row escape hatch, not a second naming policy: the derived id remains the default, and an override is rejected unless it stays inside the aggregate id space and names a row the aggregate really mounts.

Verification: `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`, `pnpm test:scripts`, `pnpm aggregate:check` (generated output byte-identical) and the repository merge gates. The rows only take effect after a DSH restart, which the running session does not perform.
