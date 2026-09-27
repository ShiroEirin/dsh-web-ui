# Agent Note: Remove the pet directory diagnostics panel from the settings page

Status: implemented

## Problem

The pet plugin's settings page (its `settings.section` seat) rendered a "Pet directory diagnostics" block above the layout fields: every registry warning the host collected at startup (v1 compat-read migration hints for `~/.codex/pets/*`, manifest fields dropped fail-closed, frames2d tracks with no frames on disk) was listed verbatim, one absolute local path per line. The owner judged the block noise on a page whose job is choosing a pet and tuning its layout: the same facts are available from the CLI and the host log, the paths are long and machine-facing, and the panel sat between the pet chooser and the display fields.

## Decision

The block is gone from the settings surface. `PetSettingsCardController` no longer fetches `/api/pet/diagnostics`, no longer carries a `diagnostics` field or projects `petDiagnostics` into its snapshot, and `PetSettingsCard` renders no diagnostics list; the `settings.diagnosticsTitle` key is removed from the plugin's zh/en dictionaries and from the dsh-i18n ru dictionary, and the `.diagnostics` / `.diagnosticsTitle` rules are removed from `settings-section.module.css`. The card's `/api/pet/pets` and `/api/pet/state` loads are untouched, so pet selection and the staged display form behave exactly as before.

The host side keeps every fact it already had: the registry still records structured diagnostics during its startup scan, `PetService.diagnostics()` and the `GET /api/pet/diagnostics` route still answer, and `node scripts/dsh-pet validate <dir>` still fails structure errors and lists content warnings. What is removed is one presentation of them — the settings page — not the diagnostics themselves. `dsh-pet` README (en/zh) therefore stops pointing at "Settings > Pet directory diagnostics" and points at the CLI validator instead.

The reference sweep covers: `satellites/dsh-pet` `src/client/PetSettingsCard.tsx`, `src/client/locales.ts`, `src/client/settings-section.module.css`, the deleted `tests/pet-diagnostics.spec.tsx`, the diagnostics stubs in `tests/pet-section.spec.tsx`, `tests/pet-settings-dispose.spec.tsx`, `src/client/PetSettingsCard.test.tsx`, both READMEs and their `README.i18n.yaml` pairing record, plus `packages/dsh-i18n/src/client/ru/pet.ts`.

## Alternatives considered

Keeping the block but collapsing it behind a disclosure was rejected: a settings page that hides machine paths still ships them, and the owner's instruction was removal, not restraint.

Keeping only `level: 'error'` diagnostics was rejected: the reported noise is almost entirely warnings (v1 compat hints, drops from broken voice packs), so the panel would still render for exactly the installs the owner saw while losing the information that explains it.

Removing `/api/pet/diagnostics`, `PetService.diagnostics()`, and the registry's diagnostics collection along with the panel was rejected: those are the host's diagnostic facts, used by the route family and by future surfaces, and the request was about the settings panel. Deleting them would have been a second, unrequested change with its own test fallout.

Routing diagnostics into a toast or the pet hover panel was rejected as a new interaction to design for information nobody asked to see in the GUI; the CLI already answers "why was this pet refused".

## Consequences

An install whose pets fail validation now shows the pet list without explanation; the reason lives in `node scripts/dsh-pet validate <dir>` and the host startup log. `PetSettingsCardState` loses the `petDiagnostics` member, so any consumer outside this package that read it must stop — the settings card is the only consumer today. The removal also drops one request per settings page open, so a failing endpoint can no longer produce a silent retry path.

The change lives in the `dsh-pet` satellite repository: it is committed there, and this repository moves its `satellites/dsh-pet` gitlink once that commit is pushed (a gitlink may not pin unpushed content). It also changes the built client bundle, so an already-running DSH service keeps serving the previous `lib/client.js` until it is restarted (a page refresh alone is not guaranteed to refetch it).

## Testing

`satellites/dsh-pet`: `pnpm typecheck`, `pnpm test` (554 passed across 45 files), and `pnpm build` all pass; the rebuilt `lib/client.js` no longer contains `settings.diagnosticsTitle`, "Pet directory diagnostics", or `/api/pet/diagnostics`. The removed `tests/pet-diagnostics.spec.tsx` is replaced by regression coverage in `tests/pet-section.spec.tsx` (the settings page renders no `[data-dsh-part="diagnostics"]` and never requests the endpoint) and `src/client/pet-css.test.ts` (the settings stylesheet no longer carries the diagnostics rules). Root: `pnpm i18n:check` proves zh/en/ru key parity after the ru key removal, and the README pairing record is re-recorded so `pnpm docs:check` holds for the satellite pair. The live GUI tab was not driven: its host is token-gated and the running service still holds the pre-change bundle, so the panel is expected to disappear after the user restarts DSH and refreshes.
