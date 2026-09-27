# Agent Note: Aggregate client bundle mounts the shell's family children

Status: implemented

## Problem

After the fault-isolation shell (2026-09-01, `4b25dd771`) took effect on a
restarted host, every family client surface vanished from the web GUI: the
first-level settings sections (Workshop, Skin Center, 使用统计, Web 插件,
宠物), the pet dock, and the task-board/ssh surfaces were gone, while the
direct-mounted rows (dsh-i18n, dsh-better-sidebar, @linxin666/dsh-perf,
@eddyskywalker/dsh-chatgpt-subscription, @linxin666/dsh-session-archive)
kept working.

Root cause: the shell folds every family patch row under
`name: '@linxin666/dsh-web-all'` (the real plugin rides in `config.plugin`),
and the client module scanner (`@deepseek-ai/dsh-client-modules`) composes
the browser bundle graph from the **loader's entries** — it never sees cordis
sub-plugins created inside the shell's apply. The children's client bundles
therefore never reached the browser: no `settings.section` registrations, no
docks, no cards. The host half worked (services stay visible through the
scope chain), which is why boot audits and host-side checks never caught it.

## Decision

The aggregate's client bundle now carries the children — the client-side
mirror of the host shell:

- `scripts/aggregate.mjs` emits
  `packages/dsh-web-all/src/client/children.specifiers.json`,
  `children.generated.ts`, and `children.modules.d.ts` for every
  shell-wrapped child that ships a client face (16 today; `SHELL_EXEMPT`
  dsh-i18n and inert rows without `dsh.client` are excluded). The emission
  is owned by the generator and covered by `aggregate:check`.
- The generated module statically imports each child's `./client`
  specifier. The built `./client` artifacts are loader factory files (they
  call `window.__ModuleLoader__.load` on evaluation), so web-all's tsdown
  config aliases those specifiers onto the child **sources**; tsc reads the
  generated ambient declarations instead of following the factory artifacts.
  The shared preset gained a `clientPlugins` passthrough so the alias runs
  ahead of the bundle purity gate.
- `src/client/mount-children.ts` mounts each child as a nested client plugin
  (the child's own declared injects on a child fiber) with the same
  dual-path error capture as the host shell: one broken child degrades alone
  with a console line, the family bundle's fiber stays active, and the boot
  audit still sees a healthy tree.
- Runtime guards prevent double instances: children whose package id appears
  in the browser boot payload (profile-level direct rows such as perf and
  session-archive on this machine) are skipped, and the shared
  `Symbol.for('dsh-web.mounted-plugins')` registry (the mountOnce symbol)
  keeps one verdict across module instances.
- A mount's claims last exactly as long as its fiber: `mountClientChildren`
  registers an effect that deletes the names it claimed when the aggregate's
  fiber unloads, and only those names, so a sibling instance's claims survive.
  This is what makes an in-place replacement recoverable — the loader replaces
  a rebuilt application entry in place (fiber teardown plus re-apply, no page
  reload; only bootstrap entries force a reload), and a successor that
  inherited a dead instance's claims mounted nothing at all (2026-09-24
  report: 使用统计, Web 插件, 创意工坊 and 已归档会话 gone from the settings
  nav until the page was manually reloaded).
- A family surface is fiber-owned, not document-owned. dsh-task-board binds
  its DOM mounts (sidebar row and board container) and its settings-form
  subscription through one `ctx.effect` that runs on fiber unload. The locale
  dictionaries die in that same teardown, so a row that outlived its fiber
  kept a live controller rendering raw dictionary keys (`entry.label`,
  `board.title`, `board.showSubtasks`) while its usage and market siblings
  disappeared outright.

## Consequences

- `@linxin666/dsh-web-all`'s `lib/client.js` grows from ~14 KB to ~2.5 MB
  (the family's client code rides one artifact; the loader serves it as a
  single entry). Acceptable for a self-hosted console; splitting would need
  loader support for non-entry bundles.
- Direct-row coexistence is deduped at runtime, so profiles can keep
  repository-linked direct rows for actively developed packages without
  double-mounting their client halves.
- Adding a family package with a client face requires only
  `node scripts/aggregate.mjs` + rebuild — the mount list regenerates.
- An in-place bundle replacement now recovers instead of killing the family:
  the old fiber's teardown releases its claims and disposes its DOM surfaces,
  and the successor's apply mounts the children again into the same document.

## Verification

- Live GUI (profile `web`, after a page refresh only — no restart): the
  settings nav restored (Web 插件 / 皮肤 / 宠物 / 创意工坊 / 使用统计 return
  beside Codex 订阅 / 侧边卡片 / 会话归档管理), the pet dock and task-board
  DOM fingerprints present, and no degraded console lines.
- In-place replacement, measured on the running host (2026-09-24): touching
  the aggregate bundle that still held the pre-fix artifact kills every family
  surface in the open page (`entry.label` row, no usage foot card, and 使用统计 /
  创意工坊 / Web 插件 / 已归档会话 gone from the settings nav); the same
  treatment on the fixed artifact leaves one 任务看板 row, the usage foot card
  and the complete settings nav in place, with no reload and no duplicates. The
  one exception is that transition itself — a page whose predecessor was the
  pre-fix bundle still needs one reload, because that dead instance never
  released its claims.
- `packages/dsh-web-all` tests 67/67 and
  `@linxin666/dsh-client-ui-task-board` 553 passed / 1 skipped, including the
  new cases (`client-children-mount.spec.ts`: claim release and re-mount;
  `client-apply-teardown.spec.ts`: the DOM belongs to the fiber). Both fail
  against the pre-fix sources.
- Repository-wide `pnpm test` exit 0; `pnpm typecheck`, `pnpm i18n:check`,
  `pnpm docs:check`, `pnpm aggregate:check` all green.
