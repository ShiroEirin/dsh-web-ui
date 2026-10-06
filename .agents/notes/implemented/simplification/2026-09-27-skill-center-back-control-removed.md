# Agent Note: Skill-center back-to-conversation control removed

Status: implemented

## Problem

The skill center's panel header carried its own "‹ back to conversation" control
(`data-dsh-center-view-back`), whose click called `controller.close()` and
therefore `ctx.layout.selectPanel(null)`. On DSH 0.2.0-rc.2 every click worked
but froze the interface for seconds before the column came back — reproducible on
each press, with no console error. The lag is the panel-switch path re-rendering
the center column, not a broken handler: #1736's fix (declaring `layout` in the
client `inject`) is what made the control work at all, and the same switching
path is what the reporter observed as slow.

The control also duplicated an exit the shell already owns. The skill center is a
native center-column page: its sidebar row (`sidebar.panellist`) opens it, and
every session-revealing navigation in the shell — opening a session row, opening a
workspace, the "new chat" button — already calls `selectPanel(null)` to hand the
column back to the conversation. The shell's own Plugins and Schedule ("automation
tasks") pages carry no back control, so the skill center's was also the odd one out
visually.

## Decision

The back-to-conversation control is removed from the skill center. `SkillPanel.tsx`
renders a title header alone; `.backButton` is deleted from `panel.module.css`
(`.ghostButton` stays — the list refresh and the editor's back action still use
it); and the now-unreachable `panel.backToConversation` key is dropped from the
package's `zh`/`en` dictionaries and from the central `ru` dictionary in
`dsh-i18n`.

The panel is opened and returned exactly as the official pages are: the sidebar
row selects it, and any session navigation returns the column to the conversation.
`PanelController.open()`/`close()`/`syncPanelSelection()` are unchanged — the
controller is still the owner of `panelOpen`, the active tab and the editor target,
and the layout's `panelInfo` is still reconciled back into it, so out-of-band panel
switches keep working.

## How the panel is left

The sidebar row is a **select**, not a toggle: `SidebarRoot`'s `PanelRow` calls
`selectPanel(id)`, which the shell wires straight to `ctx.layout.selectPanel(id)`
(`ui-sidebar/src/client/index.ts:70-73`). Clicking the active row therefore writes the
same panel id again and the center column stays on the skill center — it is a
re-select, not a close. The exit paths that do return the column to the conversation
are the shell's own:

- opening any session row (`navigation.openSession` → `replaceMain(..., 'reveal')`);
- opening a workspace (`openWorkspace` → `replaceMain(..., 'reveal')`);
- the sidebar's "new chat" button (`startSession` → `replaceMain(..., 'reveal')`).

All three end in `this.ctx.layout.selectPanel(null)`. Switching to any other panel
row (Plugins, Schedule, the task board) also leaves the skill center, through the
layout rather than the plugin. So no exit depends on the removed control, and the
same set of exits is what the official Plugins and Schedule pages have.

dsh-ssh and dsh-task-board keep their own back controls: their sessions are
host-owned resources (an SSH terminal, a running task) and the reporter did not
ask for those to change. The aggregate's `[data-dsh-center-view-back]` mobile
offset rule in `dsh-web-all/src/client/index.ts` stays, because those two
controls still carry the marker it targets.

## Alternatives considered

- **Investigate and fix the `selectPanel(null)` cost instead of removing the
  control**: rejected as the durable answer for this issue. The switching path
  belongs to the shell's layout service, and its cost is not owned by this
  package; the reporter's own suggested remedy was removal, and the control
  duplicated an exit the shell already provides. If the shell's panel switch stays
  slow, that is an upstream `@deepseek-ai/dsh-client-ui-layout` concern and
  deserves its own issue against the core package, following
  [upstream root-cause issue triage](../process/2026-09-06-upstream-root-cause-issue-triage.md).
- **Keep the control but make it cheap (defer the selection, skip the re-render)**:
  rejected. It would keep a redundant exit and paper over a shell-owned cost with
  a plugin-local workaround, diverging further from the official pages.
- **Remove the back control from all three family panels at once**: rejected. The
  reporter scoped this to the skill center; dsh-ssh and dsh-task-board host live
  resources whose exit affordance is a separate question.

## Consequences

- The skill center now matches the official Plugins and Schedule pages: a title
  header, and entry/exit through the sidebar row and session navigation.
- The reported multi-second click lag on the skill center's back control is gone
  with the control, since nothing in the panel asks the layout to re-select the
  conversation any more. The layout's own panel-switch cost is unchanged and
  remains observable when switching between panels or rows.
- `panel.backToConversation` is no longer a key in the `dsh-skill-explorer`
  namespace. It survives in the ssh namespace, which still uses it.
- `controller.close()` and `controller.open()` have no caller left: the sidebar row
  selects a panel rather than closing one, and session navigation goes through the
  shell, so nothing in production asks the controller to open or close the panel
  any more. `syncPanelSelection()` still runs — `src/client/index.ts` feeds it the
  layout's `panelInfo`, which is how the controller learns the panel opened. The
  methods stay on the controller because the panel's open state is still the
  controller's to report, and `toggle()` still routes between the two; that
  `open`/`close` now have no external caller is a property of the family pattern,
  not a defect, because the task board's controller is driven the same way.

## Testing

- `tests/panel.spec.tsx` asserts the header is the title alone and that no
  `[data-dsh-center-view-back]` node or back label is rendered, and that the
  page offers no in-page close affordance.
- `tests/panel-state.spec.ts` keeps pinning the layout handshake, the
  controller-owned tab and editor target, and the referentially stable snapshot,
  and adds the exit contract: a `panelInfo` reconciliation in both directions
  must leave the layout's selection list empty, so the plugin can never be the
  thing that re-selects the conversation. Mutation-checked — making
  `syncPanelSelection` push the selection back fails that case.
- `pnpm --filter @linxin666/dsh-client-ui-skill-explorer test` (123 passed),
  `pnpm i18n:check` (15 namespaces, 1296 keys in zh/en/ru parity),
  `pnpm docs:check`, `pnpm typecheck`, and `pnpm libs:check` pass.
