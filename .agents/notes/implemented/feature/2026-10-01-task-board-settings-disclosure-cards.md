# Agent Note: Task-board settings open as collapsed topic cards

Status: implemented

Extended by [family settings cards carry an identity mark and one-line copy](./2026-10-01-family-settings-cards-identity-marks-and-copy.md): the two topic descriptions and the card's copy line are shortened, and the power-status lines become quiet small print; the disclosure layout itself is unchanged.

## Problem

The board's own settings card rendered every option in one flat body: the master
switch, the agent announcement, the idle-sleep protection, the subtask depth
limit, and the whole goal-acceptance block (switch, judge model, reasoning level
and the resolved preview), followed by the provider seat the GitHub Issues
extension contributes into.

Only the contributed card was a disclosure. The card's own options were always
visible, so opening the board card to reach one switch flooded the settings page
with copy nobody asked for, and the acceptance block's long hint dominated the
column.

## Decision

The settings card is a list of collapsed topic cards, the layout the task form
already uses ([task form regions](./2026-09-27-task-board-create-dialog-regions.md))
applied to the settings surface.

- The card's own options are two nested `PluginSettingsCard` disclosures — the
  board and its runtime behavior (master switch, agent announcement, idle-sleep
  protection, subtask depth), then task acceptance (switch, judge model,
  reasoning level, resolved preview) — rendered into the same list
  (`board-settings.module.css` `.nestedCards`) that already hosts the provider seat.
  The acceptance block's heading and divider are gone: the card's own header
  names the topic.
- Every one of the three starts collapsed (`defaultOpen={false}`), on the board card
  and on the GitHub Issues section alike, so the settings page opens as a short
  topic list.
- The nested cards carry `hideFooter`: they stage into the board card's one form
  and are written by its single save row, which stays the only save affordance.
  Their chrome state therefore reports `dirty: false` — the outer header owns the
  unsaved pill — while `writable` follows the form so a read-only deployment still
  says so inside an expanded topic.
- The board card keeps its own disclosure header and its power-status lines;
  only the options moved.

### Copy

`settings.enabledCardHint` and `settings.goalVerificationCardHint` are the two
topic descriptions (zh and en in the package, ru mirrored in `packages/dsh-i18n`).
The long field hints stay on the fields they explain, so a collapsed header is
one line of description.

## Alternatives considered

**Leave the flat layout and only collapse the acceptance block.** Rejected: the
master switch is what the user opens the board card for, and a page whose first
row is a wall of hint text is what the report was about.

**Give each nested card its own save footer.** Rejected: the three topics write
one settings namespace through one atomic mutation; two or three save buttons for
one document invite a partial save and a second confirmation step with no effect.

**Move the remaining board fields (announcement, idle sleep, subtask depth) out
of the first topic.** Rejected: they are the board's own runtime behavior and are
meaningless with the board switched off; splitting them from the master switch
would have left orphan fields between two cards.

**A new accordion component instead of the shared card chrome.** Rejected: the
provider seat already renders the shared `PluginSettingsCard` in exactly this list,
and the request was for the same chrome; a second disclosure recipe would drift
from it.

## Consequences

- The board card opens as three topic rows plus the power-status lines; each topic
  is one click away and keeps its own fields and hints.
- The GitHub Issues section starts collapsed, so its repository and credential
  summary needs one click to read; it keeps its own save row for its own namespace.
- No stored value, wire field, ledger schema or settings key changes: only
  presentation and two new copy keys.
- Coverage: `packages/dsh-task-board/tests/settings-card-disclosure.spec.tsx` drives
  the whole disclosure in jsdom (one header while collapsed, three collapsed
  topics after expanding, each topic's controls and the provider seat inside one
  list) and `packages/dsh-task-board-github/tests/github-ui.spec.tsx` covers the
  contributed card's collapsed default.
- Evidence beyond the unit specs: a scratch-home host (`DSH_HOME=/tmp/dsh-verify`,
  the web profile's local aggregate, `--port 19400`) was driven through headless
  Chrome CDP and captured under `packages/dsh-task-board/docs/e2e/`
  (`tb-settings-topics-collapsed.png`, `tb-settings-board-topic-open.png`,
  `tb-settings-acceptance-topic-open.png`, plus the transcript). The user's own
  host was never restarted or re-bound; a page refresh picks the rebuilt bundle up.