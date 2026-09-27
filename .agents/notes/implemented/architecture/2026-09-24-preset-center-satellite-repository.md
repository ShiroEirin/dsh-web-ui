# Agent Note: The preset center moves to the dsh-presets repository

Status: implemented

## Problem

The preset center was the last content contribution this repository accepted from outside contributors, and it carried the same three costs the [family satellite split](2026-09-23-family-satellite-repositories.md) removed for the skin center, the pet plugin and the community plugin index (see [Workshop accepts agent-preset contribution PRs](../process/2026-09-09-workshop-accepts-agent-preset-prs.md)).

A preset is content: a directory under `presets/<id>/` plus a `catalog.json` entry, read by the market build and served by dsh-market.com. Adding one meant forking a monorepo carrying sixteen plugin packages, and the review route for it was the generic family-plugins route rather than a content route. The catalog could only ship on the family release train, while the three content kinds that already moved reach users through the market pin alone. And the pull-request gate had to keep one exception open — presets — which made "this repository accepts no external PRs" impossible to state.

## Decision

The preset center lives in [dsh-presets](https://github.com/zhu1090093659/dsh-presets) and this repository consumes it the way it consumes its three siblings.

- **The plugin is a published npm package.** The aggregate declares `@linxin666/dsh-client-ui-preset-center: ^0.4.1` by hand and mounts it through an external `rows:` entry (`web-ui-preset-center`); `./preset-center` stays in the aggregate exports as a compatibility tombstone. The npm 0.4.1 already on the registry is the pre-split build of the same sources, so the switch lands without waiting for a satellite release.
- **The catalog is a pinned market input.** `market-inputs.lock.json` gains a fourth input (`satellites/dsh-presets`, content directory `presets`, target `presets`), the repository gains the matching submodule in `.gitmodules`, and `scripts/market-build` reads `.market-inputs/presets` exactly as it reads skins, pets and the community index. The in-repo fallback path stays for the fixture-based script tests, the same way the three earlier fallbacks did.
- **The satellite owns its own lane.** dsh-presets ships its own CI (catalog gate, script tests, typecheck, tests, build, and a rebuild-and-diff of the committed `lib/`), its own release workflow, its own PR routing, and a contribution checklist derived from `presets/README.md`. `scripts/preset-catalog.cjs` mirrors the invariants the market build enforces over the catalog, so a contributor catches a broken submission before the pin moves.
- **The pull-request gate has no exception left.** `reject-non-content-pr.yml` redirects a `新预设收录` declaration to dsh-presets like the other three content kinds; the PR template, [CONTRIBUTING.md](../../../../CONTRIBUTING.md), [PR_TRIAGE.md](../../../../PR_TRIAGE.md) and [ISSUE_TRIAGE.md](../../../../ISSUE_TRIAGE.md) now state that this repository accepts no external contribution directly.

## Alternatives considered

**Move the plugin and keep the catalog here.** Rejected: the two share one publishing contract — the plugin's library paths, provenance format and catalog schema are read against the same `presets/` bytes — and the three earlier satellites all keep their plugin and their content in one repository. Splitting them would put the validation of a preset outside the repository that publishes it.

**Keep the catalog in this repository and publish it from here.** Rejected: the content would still arrive through monorepo pull requests, which is the cost being removed, and the market build would keep reading a working-tree path instead of a pinned commit.

**Wait for a dsh-presets release before switching the aggregate.** Rejected: the registry already carries 0.4.1 built from these sources, so the aggregate can move now and the satellite's version line advances independently afterwards.

**Author the satellite's content gate from scratch.** Rejected: a second definition of a valid preset drifts from the market build's. `scripts/preset-catalog.cjs` restates those invariants deliberately, and the market build stays the authority that the pin is measured against.

**Move the Russian dictionary with the package.** Rejected: `dsh-i18n` is the single home of the third language for every family namespace, and it resolves namespaces by string, not by dependency. Its `preset-center` entry stays and the audit now reports the namespace as one no audited package registers — the same state the pet namespace has been in since its own split.

## Consequences

- This repository publishes fifteen packages instead of sixteen, and its `family-packages` discovery, release inventory, coverage baseline and test-standards baseline all shrink by one package.
- Two packages commit `lib/` here (`dsh-market`, `dsh-web-all`) instead of three; `libs:check` records two source fingerprints.
- `scripts/sync-shared.mjs` generates 96 copies instead of 101: the preset center no longer receives the mount-once, dsh-home, run-guarded, loopback and http helpers as vendored copies. dsh-presets carries them the way the other satellites do.
- The aggregate's client bundle no longer inlines the preset panel. Its browser half now mounts from the satellite's own loader entry, so a preset-center source change no longer forces a `dsh-web-all/lib` rebuild — and the panel needs the published package installed to render.
- Market output changes only when the submodule gitlink moves: a merged preset reaches dsh-market.com after a maintainer moves `satellites/dsh-presets` and rebuilds `market/dist`, not when the satellite merges.
- The submodule gitlink must name a commit that exists in dsh-presets; until that repository is pushed, a fresh clone cannot resolve the pin (a checkout that already carries the satellite working tree still builds).

## Testing

- dsh-presets: `pnpm preset:check` (32 presets), `node --test scripts/preset-catalog.test.mjs` (9 tests, all refusals plus the committed catalog), `pnpm typecheck`, `pnpm test` (55 tests in 7 files), `pnpm build`.
- This repository: `aggregate:check` (14 rows, 13 workspace deps, 12 client children), `market:check` against the pinned inputs, `libs:write` then `libs:check` (2 packages), `sync-shared:check`, `typecheck`, `test:scripts` (340 tests), `test`, `test:standards`, `docs:check`, `i18n:check`, `emoji:check`, `runtime-deps:check` (2 scanned packages).
- `packages/dsh-web-all/tests/satellite-rows.spec.ts` now pins the preset-center row: id, direct mount with no shell wrapper, the declared semver range, the `./package.json` export the generator resolves, the `./preset-center` tombstone, and its absence from the inlined client children.
