# Agent Note: Task-board schedules carry an explicit IANA time zone

Status: implemented

## Problem

A task-board schedule was a bare 5-field cron expression evaluated against whatever zone the Host process happened to report. `ScheduleRule` was `{enabled, cron, nextRunAt, lastTriggeredAt}` with no zone, `core/schedule.ts` read `Date` field accessors (the process zone) and built candidates with `new Date(year, month, day, hour, minute)`, and the `scheduler.timeZone` the ledger persisted was re-derived from `Intl.DateTimeFormat().resolvedOptions().timeZone` on every load and read by nobody except the board header and the client's timestamp formatter.

Three consequences followed.

- **A `TZ` change silently moved every armed rule.** The persisted zone string was informational, so an existing schedule kept firing on the same cron text read in the new zone: a "every day 09:00" rule moved by the offset difference with no user action and no record of the change.
- **Wall-clock intent could not be expressed at all.** A user who wanted 09:00 Shanghai while the Host ran in UTC had no way to say so, and the cron text alone cannot carry it.
- **The zone was implicit in the test suite.** `tests/schedule-dst.spec.ts` established its zone by mutating the global `process.env.TZ`, which is the only way to reach the old engine and is not a property of any rule.

Independently, the day-field gate diverged from Vixie cron. It treated only the literal `*` as unrestricted, so a stepped star paired with a restricted weekday, such as `0 0 *&#47;2 * 1`, fired on every stepped day **in addition to** the matching Mondays. Upstream `@deepseek-ai/dsh-schedule` selects the day branch from whether the field text *starts with* `*`, making that expression "the Mondays that fall on a stepped day of month".

## Decision

A schedule rule carries its own IANA zone, and the cron engine resolves wall clocks in that zone rather than in the process zone.

### The rule and its persistence

- `ScheduleRule` gains an optional `timeZone?: string`. Absent means the Host zone, which is what a rule written before zones were persisted keeps following.
- The ledger schema moves to v4. Migration from v2 or v3 proves every row is structurally valid (a document that would drop or coerce rows still fails loudly and keeps the original file), then stamps the current Host zone onto every rule that stored none. Stamping is what stops an existing rule from following a later `TZ` change; the trigger instant is untouched, because the stored `nextRunAt` already encodes the old zone.
- `normalizeSchedule` keeps a stored zone only when this runtime resolves it, so a typo or a zone missing from this ICU build is cleared (the rule falls back to the Host zone) instead of failing every later resolve.
- `applySetSchedule` refuses an unusable zone and takes the Host zone as a parameter, so the fallback is explicit rather than re-derived inside the use case. `applyCreateTask` grows the same parameter and refuses a requested unusable zone instead of silently reinterpreting it.

### The engine

`nextRunAtMs(expr, fromMs, timeZone?)` reads and writes wall clocks through a cached `Intl.DateTimeFormat` for the requested zone. `zonedEpoch` resolves a wall clock by probing the zone's offset a day either side of the naive guess and keeping every candidate offset that maps back to the requested fields: no survivor means the wall clock does not exist (a spring-forward gap) and the date is skipped, several means it is ambiguous (a fall-back overlap) and the earliest instant wins so the repeated clock fires once.

The day gate now follows Vixie: `dayStarred`/`weekdayStarred` are read from whether the field text starts with `*`, and both fields restricted means OR while every other combination means AND.

### The surfaces

- The action protocol accepts `timeZone` on `set-schedule` and creation-time `schedule`, validated at the wire boundary (`null` clears the stored zone); `task_board_schedule` accepts a `timeZone` argument, with an empty string documented as the way to clear it, so the model never has to emit a JSON null.
- A cron-triggered run's prompt states its own firing instant (UTC), the rule zone and the expression. Until now a cron run and a manual run of the same card queued byte-identical prompts, leaving the agent to infer "now" from the Host clock — which is exactly the ambiguity an explicit zone exists to remove. Manual runs carry no scheduling section.
- The detail panel and the new-task dialog gain a zone picker fed by `Intl.supportedValuesOf('timeZone')`, with the Host zone as the first entry (the one that clears the stored zone). Both editors show the next run as the absolute wall clock **in the rule's zone** plus a bracketed relative distance, computed by the same engine the Host arms with. The picker offers only zones the Host can also resolve.
- The agent-tool description and the package announcement say the rule's zone, not "the Host local time zone".

## Testing

- `tests/schedule.spec.ts` covers explicit-zone resolution (the same expression in Shanghai and UTC), the spring-forward skip, the fall-back earlier-instant rule, the process-zone fallback, both Vixie branches, the starred flags, and zone validation.
- `tests/schedule-zone.spec.ts` covers the picker inventory (Host entry first, no repeats, every offered id resolvable, a usable list when the Host reports no zone) and the relative/combined next-run wording.
- `tests/host-ledger.spec.ts` covers both migration branches: a v3 rule with no zone is stamped with the Host zone while keeping its committed instant, and a v3 rule that already has a zone keeps it. `tests/store.spec.ts` covers zone round-trip and the unresolvable-zone repair. `tests/protocol.spec.ts` covers the wire gate, `tests/agent-tools.spec.ts` the tool argument (including the empty-string clear), and `tests/subtask-run.spec.ts` the scheduled-run prompt section.
- The engine was differentially checked against `@deepseek-ai/dsh-schedule`'s resolver over 12 IANA zones (including 30-minute and 45-minute DST offsets, negative DST in Dublin, and the Apia date-line jump) and ~300k decision instants, with zero mismatches; a containment run confirmed the only behavior change against the previous implementation is the star-led day-field fix.
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm test:standards`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm test:scripts`, `pnpm emoji:check`, `pnpm aggregate:check`, and `pnpm libs:check` all pass.

## Upstream is experimental: what to re-verify

Every package this change drew its semantics from is an internal `0.2.0-rc.1` release on the `experimental` track, and the bundle that mounts them is the optional one: `dsh-experimental-schedule-bundle`'s own README says it "ships switched off" in every installation (`OPTIONAL_BUNDLES` names it, and the plugin manager offers it under the Official group). The profile this work was verified against carries it enabled with `ui-schedule` disabled — the "2 running, 1 disabled" the attachment shows — so the board's scheduling has to stay correct in both states.

**The board has no runtime or build dependency on any of them.** The only reference to `@deepseek-ai/dsh-schedule` anywhere under `src/` is the provenance comment in `core/schedule.ts`: there is no import, no `inject` entry, no peer range, and `dsh-time-context` is not referenced at all. These packages are not even in the repository's dependency set — unlike the other `@deepseek-ai/dsh-*` packages the family consumes, they resolve only inside an installation that enables the experimental bundle. A rename, a breaking change, or the removal or promotion of these packages upstream therefore cannot break the board's scheduling, and no cohort bump is forced by this change. That is also why this section records *how to re-verify* rather than a dependency to track.

What would go stale silently, in the order it is most likely to:

1. **The DST and Vixie semantics the engine is asserted to match.** The byte-identical claim rests on the differential run recorded under Testing. Note what does *not* protect it: no test imports the official package, and unlike the other `@deepseek-ai/dsh-*` packages this one is not a repository dependency at all — it resolves only inside whatever DSH installation has the experimental bundle enabled. So nothing in CI fails when upstream changes a rule, and the harness cannot simply be re-run from a clean checkout: it was an ad-hoc script that read the installed package and is not committed here. Reconstructing it means resolving `@deepseek-ai/dsh-schedule` from an installation that carries the bundle, importing its `lib/types/domain.js`, and comparing `resolveCronOccurrence(...).nextScheduledAt` against `nextRunAtMs` over the same zone/instant sweep. If a future `resolveCronOccurrence` (or its `localInstant` / `canonicalizeCronExpression` helpers) picks the *later* instant on a fall-back overlap, or changes how the day-of-month/day-of-week branch is selected, the board keeps the behavior recorded here while the comment in `core/schedule.ts` quietly becomes false. Re-run that check on any upstream release that touches `dsh-schedule`'s domain module, then update the comment and the Testing section together. If this section is ever revisited on a cohort bump, consider committing the harness under `scripts/` so the check stops depending on a temp extraction.
2. **Whether a scheduled run states its clock twice.** The board now appends its own scheduling paragraph on a cron trigger, because a cron run and a manual run otherwise queued identical prompts. That is only the right division of labour while the time context is the opt-in, throttled, ambient injection it is today (a prepended `agent/pre-step` listener, 10-minute default refresh). If a future version makes time context unconditional, or states the elapsed/firing clock itself, revisit the preamble so a scheduled run does not carry two clock statements.
3. **Whether the rejection of delegation still holds.** The `## Alternatives considered` rejection of routing board runs through `ctx.schedule` rests on that service not knowing the board's ledger, permission gate, run groups, or subtask cascades — not on the service being unavailable. If a later version grows a surface for running a board task, or the board's own authority boundary changes, that rejection is worth re-reading rather than assuming.
4. **Whether the official task page becomes the better home for a cross-link.** `ui-schedule` ships disabled here. If these packages leave the experimental track and the automation-tasks page becomes a shipped surface, the two scheduling surfaces sit side by side, and cross-linking them (rather than leaving them unaware of each other) may read better than it does today.

**Trigger to act**: an upstream `dsh-schedule` or `dsh-time-context` release, or any SDK cohort bump that moves those packages (the cohort commits on `dev` follow the `chore(sdk): move the official cohort to <version>` pattern). On that trigger, re-run the differential harness against the new version and reconcile it with the two places that state the expectation — the comment in `core/schedule.ts` and the Testing paragraph above. Nothing else in this change should need revisiting.

## Alternatives considered

- **Reuse the official `ctx.schedule` service (the automation-tasks plugin from the attachment) as the board's scheduler.** Rejected — the service schedules Host-wide reminders delivered as follow-up messages in their original Session; it owns its own record store and delivery history and knows nothing about the board's ledger, permission confirmation gate, run groups, or subtask cascades. Routing board runs through it would split the authority the package's whole design rests on: the ledger is the single source for what a card does, what it may do, and what it opened. The native-panel note already rejected this for the same reason. What is genuinely adoptable from the official stack is its *semantics* — an explicit IANA zone per rule, and the gap-skip/earlier-on-overlap DST policy — which this change adopts in the board's own engine, verified against it rather than reimplemented from guesswork.
- **Depend on `@js-temporal/polyfill` (what the official engine uses) instead of `Intl`.** Rejected — the engine is imported by both halves of the plugin, including the browser bundle, and the package's browser-purity rule admits only platform-seed value imports. `Intl.DateTimeFormat` resolves the same wall clocks with no new dependency, and the differential run above is the evidence that it does so identically.
- **Import the official resolver directly from `@deepseek-ai/dsh-schedule/lib/types/domain.js`.** Rejected — that is an unindexed deep import outside the package's declared `exports`, and its module graph still reaches `@deepseek-ai/dsh-session` and therefore cordis. It would also make the browser preview depend on a Host-side service package.
- **Keep the zone Host-global and only expose it in the UI.** Rejected — it leaves the `TZ`-change bug in place, since the rule still resolves against the process zone, and it cannot express "09:00 Shanghai on a UTC Host" at all.
- **Follow the Host zone at trigger time instead of stamping a zone at migration.** Rejected — that is the current behavior, and it is precisely what makes an armed rule move under the user without a record.
- **Keep `default`-ing the day gate on the literal `*` to avoid a behavior change.** Rejected — the Vixie reading is what upstream implements and what an operator writing `*/2` alongside a weekday means; keeping the old gate would preserve a rule that fires on days the user did not name.

## Consequences

- A schedule states its own clock. Changing the Host's `TZ` no longer moves an armed rule, and a user can arm 09:00 in a zone other than the Host's.
- The ledger is v4 and a v2 or v3 document is migrated on load, stamping the Host zone onto rules that had none. A failed migration still fails loudly and keeps the original file.
- Wall-clock resolution is now identical to the official schedule service's: gaps are skipped and an ambiguous fall-back time fires once, at the earlier instant. The previous engine's spring-forward behavior was already "normalize forward"; the gap date is now skipped, matching upstream.
- `0 0 *&#47;2 * 1` and similar star-led day fields paired with a restricted weekday change meaning to the Vixie reading. This is the only cron behavior change; a containment run over 24 expressions found no other expression whose resolution differs.
- The client computes its next-run preview with the shared engine, so a preview can no longer disagree with what the Host arms. A rule whose zone this runtime cannot resolve falls back to the Host zone rather than breaking the editor.
- The zone picker is a `<select>`, and a select whose value matches no option falls back to its first option — then *saves* that on the next change. Two consequences are guarded explicitly: the "follow the Host zone" entry is always present (a snapshot that has not reported a zone must not leave the control resting on an unrelated zone), and the inventory is never capped while a stored zone absent from it is appended. An early draft capped the list at 300 entries; a rendered test caught that Europe/London was truncated away, so opening a Shanghai rule and changing the zone silently wrote a different one. The same class of failure is why the rendered tests exist rather than only the pure helper tests.
- A cron-triggered run's prompt is no longer byte-identical to a manual run's: it gains one scheduling paragraph. The tag, handover and run-shape sections and the body are unchanged, so the prompt-cache prefix for the task text itself is unaffected.
