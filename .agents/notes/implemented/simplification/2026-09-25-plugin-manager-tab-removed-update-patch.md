# Agent Note: Plugin-manager tab removed; update check patched into the official plugin page

Status: implemented

## Problem

`dsh-plugin-manager` registered its own "Plugin manager" tab into the official Plugins settings section (`settings.plugins.tab`, id `family-plugins`, order 20). The tab had outlived its reason: installing, uninstalling and enabling had already moved to the official plugin manager page, which owns the panel, so the tab was a second surface competing with the page that actually owns plugin management. What remained in it — a read-only inventory with aggregate child rows, the install-conflict ledger, the boot-failure repair conversations and the safe-mode banner — was UI no official page renders, duplicating inventory the official page already draws from its own authoritative source.

The one capability the official page genuinely lacks is comparing an installed plugin against the version its registry source serves, with the DSH-runtime compatibility gate.

## Decision

The "Plugin manager" tab is removed. `src/client/PluginManagerTab.tsx`, `tests/PluginManagerTab.spec.tsx`, the `settings.plugins.tab` registration, and the tab-only UI logic are gone; the package no longer registers any `settings.plugins.tab` entry.

What replaces it is the update check alone, contributed into the official Plugins page through the `plugins.detail.section` seat that page declares (`src/client/PluginUpdatePatch.tsx`, id `family-update-check`, order 30). The official page renders one section per contribution on each bundle / row / official-plugin page and passes the page's `subject` (`{kind:'bundle',pkg}` / `{kind:'row',pkg,row}` / `{kind:'item',id}`); the patch returns `null` unless the subject is an installed bundle, so it appears exactly where an installed package can be compared against its registry source. It draws a plain `<button>` and its own section rather than the official primitives bundle, keeping the entry free of a dependency the loader might not serve.

Removed with the tab, because nothing else consumed them: `src/core/repair.ts` and its dictionary keys (repair seed builders), the client-side `parsePluginControlSnapshot` / `PluginControlItem` wire parsing, `diffControls` / `classifyChange` / `ControlChangeKind`, the `failures()` / `status()` / `setSafeMode()` client faces, the `/plugin-control` RPC channel use, and the tab-only CSS. `src/core/conflict.ts` keeps only the `ControlChange` row shape, which is what the gateway host records.

The host half is unchanged: every `/api/plugin-manager/*` route, the CLI gateway, the conflict / notice ledger on `GatewayJob`, and the boot preflight all stay. The `'pluginManager'` cordis service stays with its frozen cross-plugin contract (`dsh-market` consumes it), and `failures()` is deliberately left on it: it is host bookkeeping a sibling plugin may observe even though no first-party surface renders it now. The `dsh.client.inject` list drops the rows only the tab needed (`api-session-controller`, `api-workspace-controller`, `ui-workspace`) and the settings surface (`ui-settings`, whose slot contracts the patch does not consume); `ui-renderer` STAYS because it is the provider of the `ctx.slots` registry the patch registers into.

Consolidated here: the collapsible aggregate child list ([collapsible aggregate child list in the plugin manager](../feature/2026-09-10-plugin-manager-collapsible-children.md)), which existed only inside the removed tab. Its unique content is preserved below; the feature is absent from production code, configuration, schemas, durable formats, migration and compatibility behavior, and no current documentation presents it as available.

- Problem: a bundle such as `@linxin666/dsh-web-all` claims 40+ entry rows, more than 20 of them user-visible family plugins (issue #1439). The tab rendered every child row inline under its owning package row, so each installed aggregate added 20+ switch rows to the settings page and pushed the built-in product switches far below the fold.
- Decision: the child list was a collapsed disclosure. The owning row rendered a toggle button carrying an `N/M child plugins on` summary (`childrenSummary`), with `aria-expanded` and `aria-controls` pointing at the list; the child rows and the `childrenHint` paragraph rendered only while expanded. The list started collapsed on every mount, and each parent row expanded independently, keyed by the owning plugin id.
- Alternatives considered for that decision: native `<details>/<summary>` (no controlled `aria-expanded`, and the summary text has to track the React row model anyway); persisting the expanded set in `localStorage` or the profile (a default-collapsed list already answered the request and added no durable state); auto-expanding while a child toggle was in flight (the row refreshed from the returned parent row, so the summary updated without the list jumping).
- Consequences of that decision: rows with `children === []` rendered neither the toggle nor the hint; the parent row kept its `enabled`/`disabled`/`mixed` label, the per-child switch semantics, the `data-plugin-row` anchors and the `lockedRowHint` for core rows, with only visibility changing; counts derived from the row the tab already rendered, so a child toggle updated them through the "refresh from the returned parent row" path.
- Verification for that decision was `tests/PluginManagerTab.spec.tsx` (default-collapsed state and summary, expand/collapse round trip, per-parent independence, and the child toggle still calling `setEnabled(entryId, false)` with the summary refreshing to `1/2`). That spec is deleted with the tab; the child-row enablement it exercised is host behavior and remains covered by `tests/set-enabled.spec.ts` and `tests/rows.spec.ts`.

## Alternatives considered

- Migrate every removable capability into `plugins.detail.section`: the seat renders on a page per subject, so a boot-failure ring belongs to no page (it is plugin-level, not bundle-level), the conflict ledger is an install-transaction outcome rather than page content, and the official page already owns inventory and enablement. Spreading them across contributions would rebuild the tab inside someone else's page.
- Keep the tab and hide it unless an update exists: an empty or self-hiding tab is worse than no tab, and the official page is where a user managing plugins already is.
- Keep the inventory as a patch section: it duplicates what the official page renders from the authoritative source, and duplicated inventory drifts silently.
- Keep `repair.ts` and its dictionaries for a future repair surface: unused exports with unused copy are the maintenance surface this change exists to remove; they are recoverable from git if a repair surface returns.
- Render the patch through `@deepseek-ai/dsh-client-ui-primitives` `Button`: the official primitives are a closure-factory client bundle whose members load through the module table; a plain button keeps the contribution self-contained.

## Consequences

- The Plugins settings section shows only the official tabs; the package contributes no tab and no first-party settings section.
- The update block renders inside the official page on an installed bundle's page. It checks on an explicit click rather than on mount, because one check reads every installed plugin's registry manifest and a page visit must not fan that out.
- The compatibility gate is unchanged in behavior: the block names the declared DSH minimum, disables the update action when the host is below it, and the host update route still returns 412 before starting a CLI job it cannot verify.
- The install-conflict ledger and the duplicate-mount notices are still recorded and still returned on the gateway job wire, but nothing in the GUI renders them. A consumer must be added deliberately if that changes.
- The `settings.pluginManager` locale namespace shrinks to the keys the block renders; the ru dictionary in `dsh-i18n` is mirrored and `pnpm i18n:check` passes.
- Bundle surfaces `plugins.detail.section` from the official page, so the contribution waits for that declaration through `ctx.slots.inject` — the same idiom family plugin cards use for `plugins.bundle.config`. On a host whose official page does not declare the seat, the entry never registers and the rest of the package still works.

## Testing

- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx` (10 tests): placement (nothing outside an installed bundle, local-only degradation), the check verdict for a newer / current release, an in-section check failure, the double-click guard, applying the update for the page's bundle with its restart hint, the DSH-minimum block, and an in-section update failure. Assertions read the section's state attributes so a wrong version or a missing gate fails.
- `packages/dsh-plugin-manager/tests/service.spec.ts` asserts the `pluginManager` contract shape, that the registered slot is `plugins.detail.section`, that the patch shares the face, and the `onChange` semantics.
- Gates run: `typecheck`, `test` (201 tests, 16 files), `build`, `pnpm i18n:check`, `pnpm emoji:check`, `node scripts/test-standards.mjs packages/dsh-plugin-manager`.
