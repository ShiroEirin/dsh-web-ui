# Agent Note: a satellite link requires an installed checkout

Status: implemented

## Problem

The Desktop client on the 0.2.0-rc.1 host reported the skin-center plugin as failing to import, and the host half of `@linxin666/dsh-client-ui-skin-center` failed to load from the profile:

~~~text
ERR_MODULE_NOT_FOUND: Cannot find package 'jpeg-js'
  imported from /Users/zcl/code/dsh-web/satellites/dsh-skins/lib/index.js
~~~

`scripts/link-profile.mjs` links the four satellite repositories under `satellites/` into `~/.dsh/profiles/node_modules/@linxin666/`, and it admitted a checkout as soon as `lib/index.js` existed. That test cannot distinguish a working checkout from a clone that was never installed: the satellite repositories commit their built `lib/`, so the entry file proves nothing about the runtime dependencies the bundle externalizes. The links therefore pointed at checkouts without `node_modules`, and the loader resolved `jpeg-js` (dsh-skins), `clsx` (dsh-pet) and `schemastery` (dsh-community-plugins, dsh-presets) nowhere.

The failure mode is the worst shape a link bug can take: a broken link is not a degraded feature, it aborts the plugin's import at host startup, and the same check guarded the aggregate's own satellite relink, so `node scripts/link-profile.mjs` could also move the aggregate's working pnpm-store links onto the same unrunnable checkouts.

## Decision

A satellite checkout is linked only when it can actually be loaded. `satelliteLoadability(dir)` reports the checkout usable when the package entry named by `main` exists AND every runtime dependency resolves from the checkout itself, which is exactly the state `pnpm install` inside that satellite produces.

When the checkout is not usable, the link points at the installed copy the aggregate resolves instead — the same registry artifact `dsh plugin add` installs, dependencies included. `decideSatelliteSource(localLoadable, hasInstalled)` returns `local` (a runnable checkout, so satellite edits keep reaching the GUI without a release), `installed` (the fallback), or `skip` with a loud report when neither exists. `decideAggregateRelink` takes the same verdict and returns `skip-report` for an unusable checkout, leaving the aggregate's pnpm-store link untouched.

The dry-run report of a replaced link names the new target as well as the old one; it previously printed only the current target, which reads as if the script were about to install the broken link again.

Linking the local build again needs nothing but `pnpm install` inside the satellite checkout and a rerun of the script.

## Alternatives considered

**Install the satellite dependencies as part of the repair and link the local checkouts.** Rejected as the shipped behaviour: installing inside four submodule checkouts is the documented opt-in for working on satellite content in place, not something a profile-link refresh should decide for the user, and it would rebuild tracked `lib/` artifacts in repositories that version them independently.

**Keep linking the checkout and let the host failure speak for itself.** Rejected: the failure aborts a plugin's import at startup, the profile has a working provider one directory away, and the user-visible symptom (a plugin listed as failing) carries nothing about the missing dependency.

**Fall back only in the profile layer and leave the aggregate relink unguarded.** Rejected: the aggregate relink is the stronger of the two, because it replaces a working link. Both paths read the same verdict now.

**Require `node_modules` to exist rather than probing the dependencies.** Rejected: an interrupted or partially pruned install leaves a `node_modules` directory that resolves nothing, and the probe costs four `require.resolve` calls.

## Consequences

- A clone that never initialized or installed a satellite still gets a working plugin: the profile resolves the installed copy, and the report names the checkout and the missing packages.
- The satellite links carry absolute pnpm-store paths whose suffixes change whenever the aggregate re-resolves; a rerun of `node scripts/link-profile.mjs` after any install repairs them, and it keeps them on the local checkout as soon as that checkout is installed.
- The profile layer no longer reaches the satellites' local builds until someone installs those checkouts, so satellite development starts with `pnpm install` in the satellite repository — the flow the repository instructions already describe.

## Testing

`node --test scripts/link-profile.test.mjs` passes 21 tests, including the new cases: a runnable checkout wins over the installed copy, an uninstalled checkout never displaces the pnpm-store link, a checkout whose committed `lib/` exists without `node_modules` reports the exact missing dependencies, and a missing entry or manifest is reported as such. The live repair ran `node scripts/link-profile.mjs`, after which the host and client entries of all four satellites resolve and import from `~/.dsh/profiles/desktop` (the community-plugins package exposes no `./client` subpath by design).
