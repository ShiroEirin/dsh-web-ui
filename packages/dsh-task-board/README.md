# dsh-task-board — DSH web GUI task board plugin

English | [中文](README.zh.md)

A hot-pluggable DeepSeek Harness (DSH) Web GUI plugin with a Host-authoritative task ledger, real DSH session execution, Host cron scheduling, and optional cross-platform idle-sleep protection. It is mounted through `cordis.patch.yml` and the profile mechanism and does not modify DSH source code.

- The browser is an asynchronous view; closing the page does not stop Host scheduling or execution settlement.
- Every run applies the pinned workspace, agent preset, and permission before sending the task prompt; by default each run creates its own DSH session, and a task can opt into continuing in its previous session instead (issue #1419).
- The display may turn off while optional power protection keeps the computer from entering idle system sleep.

## Features

- **Task board UI**: the board is the shell's own center-column panel — like the desktop application's Plugins page, it contributes a row to the shell's official sidebar panel list and a page to the layout's center-column seat, so row geometry, the active highlight, the collapsed rail, the label, and language switching are the shell's to own; the board provides five kanban columns, search, task details, archive/restore, execution history, and links to execution transcripts. Archived tasks are read-only except for restore, delete, and transcript viewing, and cannot run manually or on schedule until restored.
- **Continuation cards (data plane)**: a new task may paste a `<<<FREEZE ... >>>FREEZE` block from a session; it parses into a goal/progress/next snapshot persisted with the task (ledger v3). Cards carry a frozen badge, the detail view shows the full snapshot and freeze time, search covers snapshot text, and archive/restore matches plain tasks. The snapshot reuses the freeze security gate at the protocol layer: sensitive patterns become `[REDACTED]` with a marker, slash-prefixed command lines reject the whole snapshot, and each field is capped at 8 KiB.
- **Handover bundles and the permission confirmation gate**: a continuation card may attach a handover bundle — the pinned execution triplet (workspace / agent preset / permission) plus doc/script references. The bundle's triplet overrides the plain pin fields at execution, and the references ride the prompt as a handover preamble. A binding whose effective permission is above `sessionDefaultPermission` (default `read-only`) is unconfirmed: manual run refuses, cron skips the card and rolls to the next occurrence, and the confirm button in the task detail resolves the binding; any later permission or bundle change re-arms the gate.
- **Claim provenance wrap and source audit**: executing a continuation card (a card with a frozen snapshot) mandatorily wraps the task instruction in a source-declaration template — freeze instant, source session, and an unreviewed-content warning — composed after the handover preamble so the picking-up agent stays wary of stored prompt injection in card text. The session issuing a create/update action is stamped into the snapshot (frozenBy, re-stamped when the snapshot is replaced), and the session issuing a run/rerun lands on the execution record (initiatedBy) together with a captured copy of the freeze provenance; both are visible in the task detail. The initiator is client-asserted audit metadata, not a trust boundary.
- **Task tags (issue #1521)**: a task may carry up to eight labels. A label renders as a colour-toned badge on the card — the tone is hashed from the name, so one label always paints the same way and no colour is stored — the board header gains a multi-select tag filter built from every label in use (including archived tasks), and search also matches label names. A label with an "execution hint" is injected ahead of the execution prompt on every run as a `标签提示` block; a label without one is display and filter only, so an untagged task's prompt is byte-for-byte what it was before the feature. Labels stay editable after the first run: they classify the task and shape the next run, they are not the record of what already ran.
- **Subtasks and cascade runs**: a task can be given subtasks, either by creating one from its detail view (the form starts from the parent's workspace, preset, permission, and model, and each stays overridable) or by linking an existing task that has no parent yet; a subtask can be detached again once it is not running. The lineage gate lives in the Host: the parent must exist and be on board, a task can never be attached under one of its own descendants, and a tree may not exceed the configured `maxSubtaskDepth` (1 by default, 3 maximum). Running a task also runs its whole subtask tree concurrently — one DSH session per member, all under one run group — and the parent card stays in the running column until its own turn and every subtask have settled; its verdict fails if any member failed, and one failing subtask never stops the others. The board marks parent and subtask cards, the detail view lists the direct subtasks, and the header offers a one-click hide-subtasks filter.
- **Agent Team runs (opt-in per task)**: a task may opt into team execution in its detail view (or through `task_board_create`/`task_board_update`). Running such a task starts ONE session — the Team Lead — and the Host then asks the Agent Teams service to spawn one teammate per subtask inside it, attaching each teammate's session to that subtask's execution so the ordinary session monitor settles it. The subtree is flattened into that one Team (only a Lead may spawn); the Lead's prompt lists every teammate by name and points at the team tools, and the parent still settles only after its own turn and every subtask. A plain cascade prompts the same way but names the independent sessions instead. The mode needs the optional `agentTeams` service: a deployment without it refuses the run by name instead of silently degrading, and a subtask that pins its own above-default permission is refused because a teammate cannot carry that pin. Team runs always mint a fresh Lead session (teammate names are immutable within a Team) and use `teamProvider`.
- **Project partition (issue #1536)**: the board header offers a project row built from the deployment's DSH workspaces — "all projects" plus one entry per registered project. Selecting a project narrows the columns to the tasks pinned to it, and tasks with no pinned workspace stay visible under "all projects". Opening the new-task form while a project is open preselects that project as the task's workspace, and "new project…" registers a host directory through the same runtime call the GUI's own add-project uses.
- **AI parse of pasted text (issue #1540)**: the new-task form takes text copied from anywhere and has a model turn it into the title, description, and run prompt. The model is one of the deployment's configured models (the same list the task's model pin uses, first entry preselected), and the call runs on the Host behind the board's usual loopback and same-origin fence, with a 45 s budget and a cancel affordance. The draft only fills the form: nothing is created until the task is submitted, and a failed parse leaves what you already typed untouched.
- **Host-authoritative ledger**: tasks, schedules, and execution records live in `$DSH_HOME/task-board/ledger-v2.json`; browser actions become confirmed Host transactions.
- **Bounded execution history**: each task keeps the most recent 20 execution records; the oldest runs are trimmed when a new run starts, so ledger size and write cost stay bounded regardless of how often a task has run.
- **Real execution**: manual and scheduled runs use the same Host runner, which by default creates a fresh session, renames it, applies the agent preset and `/permission <id>`, then queues the task prompt.
- **Optional session reuse**: a task can opt into continuing in its previous execution's session (issue #1419). Reuse happens only when that session is idle and still present in the runtime roster — the Host then re-applies the pinned permission and model on it and queues the prompt, keeping the conversation title and history; otherwise the run mints a fresh session as before, so an unknown roster or a busy session never blocks a scheduled run.
- **Fail-closed pins**: a missing workspace, missing or broken preset, or rejected permission command fails before the task prompt is sent.
- **Host scheduler**: 5-field cron supports `*`, `*/n`, ranges, comma lists, Sunday `0/7`, and standard day-of-month/day-of-week OR semantics in the Host local time zone.
- **Deterministic recovery**: a running execution with a recorded session is observed after restart; an interrupted start without a session id is cancelled and is not resent.
- **Live synchronization**: mutations return a full revisioned snapshot; SSE announces revision, scheduler, and power changes, while reconnect and page visibility recovery fetch a full snapshot.
- **Optional idle-sleep protection**: off by default; when enabled it covers every running DSH session, enabled non-archived task-board schedules, and unknown session state.
- **System-prompt injection**: the Host registers a `plugin:task-board` section (order 200) through `SystemPrompt.section`, and the task-board settings can disable the announcement without disabling the board. The guidance also reminds agents to close any visible `todo_write` plan before the final answer.
- **Agent tools**: every session gets eight model-facing tools (`task_board_list`, `task_board_get`, `task_board_create`, `task_board_update`, `task_board_set_parent`, `task_board_run`, `task_board_manage`, `task_board_schedule`) that drive the same Host ledger the browser drives, so an agent can list the board, create subtasks, link or detach them, run a cascade, move/archive/restore/delete a card, and arm its cron schedule from the conversation.

## Architecture and protocol

The board view renders on first open and keeps its local view state when closed and reopened. Host synchronization, scheduling and execution remain active independently of the view.

- `src/index.ts` mounts the Host service through the official `@deepseek-ai/dsh-api-gateway`, `@deepseek-ai/dsh-workspace`, and `@deepseek-ai/dsh-host-webserver` SDKs.
- `src/host-ledger.ts` serializes actions and persists `{ schemaVersion: 3, revision, tasks, scheduler, recentRequests }` through a temporary file plus atomic rename.
- `src/host-service.ts` owns cron firing (a one-shot timer armed at the ledger's nearest target through the host's `timer` service, falling back to process timers when the host serves none), missed-trigger skipping, runner launch, restart reconciliation, and power reasons.
- `src/client/native-panel.tsx` registers the board's sidebar row and center-column page (the official `sidebar.panellist` list seat and the keyed `main` seat) and maintains the center-column exclusivity protocol with the ssh panel.
- `src/client/host-api.ts` imports legacy browser data once, submits idempotent actions, and treats Host snapshots as the only confirmed UI state.
- Same-origin endpoints are `GET /api/task-board/state`, `GET /api/task-board/events`, and `POST /api/task-board/action`.
- Every endpoint requires a browser same-origin marker: `sec-fetch-site: same-origin`, an `Origin` header, or the Host's `dsh-auth-*` browser-auth cookie. The last one is how the DSH Desktop shell reaches the board: it serves the Web GUI from `dsh-app://app/` and forwards that page's requests itself, dropping `Origin` and `sec-fetch-site` and attaching the authority-bound cookie it redeemed from the Host's launch URL at startup. Direct access is restricted to the DSH loopback origin; an authenticated same-host reverse proxy must use an explicit Host allowlist and a server-injected token. POST requests additionally require JSON. Ordinary actions are limited to 64 KiB and import to 2 MiB. The action union has no command, executable path, shell text, or arbitrary argument field.

## Agent tools

The board is operable from a conversation, not only from the GUI. Each tool drives the same Host ledger, so a card created in the GUI is immediately visible to agents and vice versa, and every gate the UI honors still holds. The surface follows the `enabled` switch: a disabled board answers no tool call, and a deployment whose runtime serves no tool registry still mounts the board with the GUI intact.

- `task_board_list` lists cards with filters (column, parent, roots only, label, free-text query, archived) plus the board summary: revision, time zone, subtask depth limit, session-default permission, and column counts.
- `task_board_get` reads one card in full: prompt, labels, parent link, direct subtasks, execution targets, schedule, permission-gate state, and the last ten execution attempts with their session ids, initiator, and outcome.
- `task_board_create` creates a task or, with `parentId`, a subtask; execution targets left unset inherit the parent, and the deployment subtask-depth limit applies.
- `task_board_update` edits content, labels, and execution targets; an empty string clears a target and an empty label array clears the labels.
- `task_board_set_parent` links an existing card under a parent, or detaches it with an empty parent id.
- `task_board_run` runs a card now (optionally re-running a settled one), cascading over its whole subtask tree; it consumes real API quota and refuses an unconfirmed above-default permission with `confirmation-required`.
- `task_board_manage` moves a card between backlog and todo, archives or restores it, or deletes it, with the Host's running-task and subtask guards.
- `task_board_schedule` arms, changes, or disarms a card's cron schedule.

There is deliberately no tool that confirms a permission binding: that gate exists so a human lifts an above-default permission, and an agent able to stamp it would make the gate decorative. An agent that hits `confirmation-required` asks the user to confirm the card in the board UI. Tool calls are attributed: a run records the calling session as its initiator, and a create/update stamps it into a continuation card's snapshot.

## Install

Install the aggregate package or this package alone, then restart `dsh web`:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest
```

For local development:

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board
```

## Configuration

| Key | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Enables the Host service and browser board. |
| `announceToAgent` | `false` | Opt-in: when true, adds the task-board guidance section to agent system prompts. |
| `preventIdleSleep` | `false` | Holds one system idle-sleep assertion while any DSH session runs, any schedule is enabled, or session state is unknown. |
| `trustedProxyHosts` | `[]` | Canonical `host[:port]` authorities accepted only through the authenticated loopback reverse-proxy path. |
| `proxyTokenEnv` | `DSH_TASK_BOARD_PROXY_TOKEN` | Environment variable containing the reverse-proxy token; the token itself is never stored in plugin config. |
| `sessionDefaultPermission` | `read-only` | The deployment's session-default permission. A card whose effective permission (handover bundle or pin) is above this value requires a human confirmation before it may run; cron refuses unconfirmed cards. |
| `maxSubtaskDepth` | `1` | Subtask depth limit, 1 to 3. At 1 a task may carry one level of subtasks and a subtask cannot be given subtasks of its own; every extra level multiplies the sessions one run of the root opens. |
| `teamProvider` | `spawn` | Continuable-subagent provider the Agent Teams service composes a teammate from. Only team-mode runs use it; it matches the Agent Teams tool plugin's `freshProvider` default. |

Direct browser access remains limited to the DSH loopback origin. For a same-host authenticated reverse proxy, bind DSH Web to loopback, set `trustedProxyHosts`, place a high-entropy token in the environment variable selected by `proxyTokenEnv`, and configure the proxy to replace (not forward from the client) `X-Dsh-Task-Board-Proxy-Token` after it authenticates the request. The proxy Host must be allowlisted, and the browser `Origin` must have that same authority. Restart the Host after changing these composition-level proxy settings.

On macOS the backend starts `/usr/bin/caffeinate -i -w <host-pid>` and never requests `-d`. On Windows it starts the absolute Windows PowerShell under `SystemRoot` with a fixed helper that requests only `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`; it never requests `ES_DISPLAY_REQUIRED`, changes a power plan, or requires administrator privileges. On Linux it starts a systemd-logind `idle` block inhibitor only from `/usr/bin/systemd-inhibit` or `/bin/systemd-inhibit`; it does not request `sleep`, `handle-lid-switch`, or a display/screensaver inhibitor. A Linux host without systemd-logind reports `unsupported` or a visible error and does not start a desktop-specific fallback. Other platforms report `unsupported`.

## Data storage and migration

- The authoritative ledger file is `$DSH_HOME/task-board/ledger-v2.json` (the file name is historical); the current document schema is v3, and a v2 document is migrated losslessly to v3 in place on the next Host start. New POSIX files use mode `0600`; Windows inherits the user directory ACL.
- A v2 to v3 migration failure (structurally invalid task rows) fails closed with an explicit error and keeps the original file untouched; it never restarts from an empty ledger silently. A corrupt or unsupported-schema file is moved to a collision-resistant `ledger-v2.json.corrupt-*` name and the Host starts with an empty ledger plus a visible scheduler error. The corrupt bytes are not overwritten.
- On the first upgraded page load for an origin, `dsh.taskBoard.v1` is imported by stable source and request ids. Tasks merge by id, strictly newer browser top-level fields win, equal timestamps keep Host fields, and execution records merge by execution id.
- The most recent 256 request ids and SHA-256 action fingerprints are stored with the ledger, so a retried mutation remains idempotent after a Host restart without duplicating full action payloads.
- Task labels are an optional `tags` field on the task row (`{ name, promptPrefix? }[]`) and needed no schema bump: a v3 document without it loads unchanged, and a malformed list is repaired entry by entry (blanks, repeats, and over-long names dropped, count capped) rather than dropping the task row.
- The import marker `dsh.taskBoard.v2.hostImported` stores the confirmed Host ledger generation only after import succeeds. A new or recovered ledger generation is offered the retained v1 data again. The v1 localStorage value remains untouched as a read-only rollback copy.
- One Host process owns a task-board ledger directory at a time through `$DSH_HOME/task-board/ledger-v2.lock`; a second Host using the same DSH home fails closed instead of concurrently writing the ledger.

## Security model

- The plugin stays inside the existing DSH Web deployment and network boundary and emits no permissive CORS headers. State, action, and SSE routes share the same access fence; bare local command-line requests are not accepted as browser requests.
- All mutation payloads use a strict, versioned discriminated union; schedule-owned timestamps and execution outcomes cannot be written by the browser.
- Workspace, preset, permission, cron, task status, and imported records are validated again on the Host.
- A card's effective permission above the configured session default enters a pending-confirmation state: the Host refuses manual runs and cron triggers until a human confirms the exact binding, and changing the pinned permission or the handover bundle clears the confirmation (no confirm-then-swap escalation).
- A task prompt is data sent to a DSH agent session. The protocol does not accept shell commands, PowerShell bodies, executable paths, or configurable helper arguments.
- Task labels are client-asserted like the prompt itself and ride the same gated action channel: the protocol gate rejects a blank name, an unknown key, more than eight labels, and an over-long name or hint. A label's injected hint is delimiter-escaped (it cannot forge the continuation-card provenance markers) and is placed outside that provenance wrap.
- The subtask lineage is validated on the Host, not in the browser: the parent must exist and be on board, attaching a task under one of its own descendants is refused, and the resulting depth must stay within `maxSubtaskDepth`. A subtask that leaves its own permission unset resolves the parent's binding at launch together with the parent's human confirmation — the binding is never copied onto the card, so detaching a subtask cannot leave a confirmed elevated task behind — while pinning its own permission puts it back under the confirmation gate; a run whose subtask tree contains an unconfirmed binding is refused before any session starts, and cron rolls the schedule instead.
- The agent tool surface reaches the same Host ledger through the in-process service rather than the HTTP fence, and it carries no confirmation capability: refusals, fail-closed pins, the depth gate and the running-task locks all still apply, and no tool call can lift an above-default permission binding.
- Power helpers use fixed executable paths, fixed arguments, `shell: false`, and bounded retry delays of 1, 2, 5, 10, then 30 seconds. The Linux helper follows the Host stdin lifetime so the systemd inhibitor is released automatically after an abnormal Host exit.

## Build and test

Node 20 or newer and the official NPM SDK packages are required; no DSH source checkout is used.

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
```

Set `DSH_POWER_SMOKE=1` to opt into the native helper smoke test on Windows, macOS, or Linux. It starts the fixed helper, waits for readiness, releases it in cleanup, and confirms process exit without changing the system power plan. Linux first probes systemd-logind with a bounded timeout; without a usable system bus the native portion is skipped while pure logic tests remain available.

## Manual verification

1. Mount the package, restart `dsh web`, open the task board, and confirm the Host time zone and power status are visible.
2. Create and edit a task; refresh or open a second same-origin tab and confirm both show the same Host revision.
3. Run a task with pinned workspace, preset, and permission; confirm a new session appears and the task settles from its `turn/end` history.
4. Enable a near-future cron, close all browser pages, and confirm the Host still creates and settles exactly one execution.
5. Stop the Host past a cron occurrence, restart it, and confirm the missed occurrence is skipped and `nextRunAt` rolls forward from current Host time.
6. Enable `preventIdleSleep`, run a long session, and let the display turn off; after restoring the display, confirm the session continued and the execution settled.
7. Disable the setting and all schedules, stop DSH, and confirm the helper exits; on macOS, `pmset -g assertions` should show no display-sleep assertion from this plugin.
8. On Linux, use `systemd-inhibit --list` to confirm that only an `idle`/`block` entry exists; the display should still follow desktop settings, while manual sleep and lid close remain under system policy.

## Known limitations

- Missed occurrences during Host downtime, system sleep, or a long pause are skipped and never queued for catch-up.
- A task that is already running skips its due occurrence and rolls to the next cron match; task runs never overlap or queue.
- DST follows the Host local wall clock: a nonexistent spring-forward minute is skipped, and a repeated fall-back minute is not replayed a second time.
- Power protection prevents only idle system sleep. It deliberately allows display sleep and lock.
- Lid close, manual sleep, hibernation, shutdown, low-battery forced sleep, and enterprise power policy are outside the guarantee.
- The plugin does not schedule wake timers and cannot wake a computer that is already asleep.
- Linux requires systemd-logind and policy permission for the current user to acquire an idle block lock. Containers, WSL, hosts without a system bus, and non-systemd systems may report `unsupported` or `error`. Whether a desktop also associates a logind idle lock with display idleness is desktop policy; the plugin does not request a screensaver or display inhibitor.
- Keeping enabled schedules armed may increase battery consumption because protection starts before their future trigger time.
- Host execution consumes the same API quota as an ordinary DSH agent session.
- Running a task also runs its subtask tree: one DSH session per member starts at once, so a deep tree opens several concurrent sessions and each consumes API quota.
- Agent tool calls are model-driven: a run or a scheduled cascade started from a conversation consumes the same API quota, and an agent can arm a schedule that keeps firing until it is disarmed or the board is switched off.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
