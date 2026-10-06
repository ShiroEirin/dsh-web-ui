# Agent Note: The task form groups its configuration into collapsible regions

Status: implemented

## Problem

Every task dialog (create, duplicate, edit, subtask) stacked all of its fields in one column: title, description and run prompt, labels, the freeze block, handover references, the workspace / agent-preset / permission / model pins, session reuse, goal runs and the cron schedule. Inside a 520 px modal with `max-height: calc(100vh - 96px); overflow-y: auto` the form therefore always scrolled, and the execution settings most cards never touch pushed the prompt and the footer actions out of view.

The same field was also misnamed: the agent-preset pin was labelled "Mode" ("模式"), a word that explains nothing about what it selects, while its roster rows for the deployment's built-in presets carry no display name at all — the picker listed bare ids (`standard`, `ptc`, `minimal`, `cordis`) beside user presets.

## Decision

The task form is a stack of collapsible regions.

### Shell

- `ModalShell` renders its fields inside `.modalBody`, which is the modal's only scroll container (`overflow-y: auto; min-height: 0`); `.modal` keeps `max-height` but is `overflow: hidden`, so the title and the footer stay put. The scrollbar remains a fallback for very short viewports and an open-by-hand dialog, but the default layout fits without it.
- Every direct child of the body is `flex: none`. A column flex item shrinks by default, and a shrunk region would clip its own fields behind its `overflow: hidden` instead of letting the body scroll — a defect only the rendered-browser measurement caught (jsdom has no layout).
- `CollapsibleSection` (`client/board/TaskForm.tsx`) renders a header button carrying `aria-expanded`, `data-dsh-part="form-section"` and a border-drawn chevron (no glyph, so no font or emoji can change it), and a body that exists in the DOM only while the region is expanded. `forceOpen` lets the owner keep a region open while it holds a blocking error, so a validation failure is never reported out of sight.
- The shell is tuned so the default layout fits a short window too: 10 px shell gap, 8 px body gap, 7 px header padding, and a two-row description field.

### Regions

`NewTaskModal` renders: AI parse (only when the deployment serves a parse face), task content (**open** by default; it also carries the duplicate's "archive original" checkbox), labels, execution settings, run mode, handover, and scheduled runs. Every collapsed header carries a one-line summary of the values it holds, built from the same localized labels its fields display (`new.summary.*` for the generic cases), so a collapse never hides the configuration without a trace. A region holding a blocking error — an invalid cron, a malformed freeze block, a failed parse — is forced open.

### Agent preset

- The field is labelled "Agent preset" (`new.agentPreset`, replacing `new.mode`) in the create dialog and in the task detail, because both surfaces offer the same choice.
- The picker keeps the runtime roster as its single authority and groups it: the four built-in presets first under `exec.mode.builtinGroup`, then every other row under `exec.mode.customGroup`. Built-in rows have no display name in the roster, so `client/board/preset-label.ts` maps exactly those four ids (`standard` / `ptc` / `minimal` / `cordis`) to localized names. The map is display sugar: an id it does not know falls back to the roster name and then to the id, so it can neither hide nor rename a preset.
- The empty value is the inherit choice. `inheritPresetLabel` names the preset the run actually lands on — the roster row marked `isDefault` — so "Inherit (deployment default: Standard)" says what a card without a pin will use.
- The task detail's execution settings use the same helper, and the handover bundle summary names the inherit choice instead of the retired `exec.mode.default` key.

### Copy

zh and en dictionaries live in the package; ru mirrors them in `packages/dsh-i18n`. The keys `new.mode` and `exec.mode.default` are replaced (not kept as aliases), and `exec.hint` now says the agent preset composes the session.

## Alternatives considered

**Keep one column and shrink it (fewer textarea rows, smaller type).** Rejected: the configuration does not fit a 520 px modal at any readable size, and hiding it by pixel budget hides it silently — a collapse at least carries a summary of what it holds.

**An accordion that auto-collapses its siblings.** Rejected: comparing a schedule against the workspace pin is a normal editing gesture; independent regions keep the form from guessing intent. The body keeps its overflow fallback for the case where the user opens everything.

**Tabs (content / execution / schedule).** Rejected: tabs are an unfamiliar layout inside a task dialog and hide the same configuration behind a second navigation concept; the requested interaction is collapse/expand.

**A static list of the four built-in presets as the picker's whole content.** Rejected: the runtime roster is the authority and already includes user presets; restricting the picker to built-ins would make a user preset unpinnable.

**A board-level default-preset setting.** Rejected: the deployment default is already the inherit target, and a board-level pin would silently override it for every card. The per-card choice stays where the judgement is made.

**Renaming the field in the create dialog only.** Rejected: the create dialog and the detail view pin the same thing; two names for one choice is the confusion the rename removes.

## Consequences

- The dialog opens as roughly six rows; the executor settings sit one click away and their values stay visible in the collapsed summaries.
- The four built-in presets read as names instead of ids, and a user preset is still listed as the roster reports it. The display map is keyed to the shipped built-in ids: a deployment that renames them still shows the roster name or the raw id (no breakage, no test failure).
- The detail view's preset field and the handover summary change wording with the create dialog; no stored value, wire field or ledger schema changes.
- Coverage: `tests/create-dialog-sections.spec.tsx` covers the default open/collapsed layout, expanding a region, the collapsed summaries, the built-in/custom grouping with the inherit default, and the forced-open error path; `tests/responsive-css.spec.ts` guards the shell overflow contract and the border chevron; the existing dialogs' specs open a region before driving its fields through `tests/form-sections.ts`.
- Evidence beyond the unit specs: a throwaway harness (git-ignored under `test-results/form-qa/`) rendered the real component and stylesheet in headless Chromium and measured the shell. At 1440x900 and 1180x720 the default layout needs 533 px of body for 533 px available — no scrollbar, no clipped field — and only the body scrolls once the user opens a region.
- The live DSH Web GUI itself cannot be driven from this process (its per-process host token is not available), so the aggregate mount lane remains the in-repo GUI check and a visual pass inside the live GUI is still owed after the bundle is rebuilt.
