# Agent Note: Remove the repository's Electron desktop app

Status: implemented

## Problem

The repository shipped its own Electron desktop application: a top-level `desktop/` project whose bundled Node runtime, dsh host and preinstalled `web` profile were packaged by `.github/workflows/desktop-release.yml` into `dsh-desktop-*` assets on every version tag, backed by its own Windows CI lanes, unit-test lanes, runtime-seed pins and README download instructions.

DeepSeek Harness now ships an official desktop client of its own. That client owns the desktop experience: it serves the Web GUI from its own delivery scheme, keeps its own profile under `$DSH_HOME/profiles/desktop`, and pulls the family from npm exactly like any other DSH installation. A second, repository-owned desktop distribution duplicated the packaging lane, the runtime payload, the cohort pins and the documentation surface while serving no capability the official client does not; its installers were unsigned local-distribution builds, and its runtime payload had to be re-pinned by hand on every cohort bump.

## Decision

The repository no longer ships a desktop application. The whole `desktop/` tree and its packaging workflow are deleted, and every lane, script, pin and document that existed only to build, test, seed or advertise it goes with them:

- `desktop/` (app, tests, runtime seeds, installer configuration) and `.github/workflows/desktop-release.yml` are removed.
- `ci.yml` drops the `pnpm test:desktop` step and the `desktop-windows` job; the root `package.json` drops the `test:desktop` script; `scripts/test-standards.mjs` no longer treats `desktop/` as a business lane and the test-standards baseline drops its three desktop test files; `scripts/rollout-verify.test.mjs` drops the bundled-host seed pin.
- The root README pair replaces the DSH Desktop download section with the official desktop client: the client shares `~/.dsh` and installs the family into its own `desktop` profile with the same `dsh plugin` command as `dsh web`.
- `packages/AGENTS.md` credits the official desktop client as the desktop surface in the removed-desktop-launcher exception.

No shipped plugin code changes: nothing under `packages/` imported the app, and the desktop-scheme handling in [the remote-access page-locality predicate](2026-09-21-remote-one-time-landing-grant.md) is what makes the family correct inside the official client.

## Alternatives considered

**Keep the app but stop packaging it into releases.** A dev-only Electron shell still needs its runtime payload, its seed pins and its test lanes on every cohort bump, and the README would have to explain why the download links are gone while the directory stays. The maintenance cost is the thing being removed, not the release attachment, so this keeps almost all of it.

**Delete only `desktop-release.yml`.** The app would remain in the tree with no build path: its lockfiles would keep resolving a pinned host cohort, its Windows-only helpers would keep their test lanes, and readers would have to infer from a missing workflow that the product is retired. Half a removal reads as breakage rather than as a decision.

**Keep the Windows CI lane for the desktop helpers.** The lane exists solely for the win32 semantics the Electron helpers encode (Path/PATH normalization, NTFS junctions, Windows tmpdir layouts). With those helpers gone the lane asserts nothing, and a green job that tests no shipped code is worse than no job.

**Port the app's features into the official client.** The official client owns its shell, its profile layout and its release channel; a plugin cannot ship installers for it. What the family actually contributes to a desktop is the plugin bundle, which the official client installs through the ordinary profile mechanism.

## Consequences

The Releases page no longer receives `dsh-desktop-*` assets, and the repository's desktop surface is the official DeepSeek Harness desktop client. Desktop users install the family with `dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`; `dsh web` users are unaffected.

The runtime-seed freshness invariant that `scripts/rollout-verify.test.mjs` enforced existed for the bundled payload only; the root lockfile check and the scaffold-floor check stay. The Windows-runner lane leaves CI with the helpers it covered, so no shipped code loses execution evidence — the deleted lanes asserted the deleted code.

The desktop-owned notes listed here record mechanisms that no longer exist; [the Electron desktop app note](../architecture/2026-09-03-electron-desktop-app.md), [the packaging workflow note](../process/2026-09-04-desktop-release-packaging-workflow.md), [the Windows CI lanes note](../testing/2026-09-06-windows-ci-lanes-for-desktop.md) and [the runtime-seed note](../simplification/2026-09-04-desktop-runtime-seed-0.3.14.md) are marked superseded, and [the root README note](../process/2026-09-10-root-readme-feature-focus-and-desktop.md) is amended where it described the app's own section.

Verification: `pnpm test:scripts`, `pnpm test:standards`, `pnpm docs:check`, `pnpm typecheck` and `pnpm test`. No `dsh web` restart is involved — no bundle, patch row or runtime source changes.
