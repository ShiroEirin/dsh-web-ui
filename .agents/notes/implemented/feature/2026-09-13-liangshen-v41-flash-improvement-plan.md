# Agent Note: LiangShen mode improvement plan for DeepSeek V4.1 Flash

Status: implemented

English | [中文](2026-09-13-liangshen-v41-flash-improvement-plan.zh.md)

## Problem

LiangShen combines a short persona, workspace instructions, and one tool presentation declared for the session's whole lifetime. The current evidence does not establish that this composition improves DeepSeek V4.1 Flash task success, and the tool catalog must describe exactly the surface the request carries. This contract had to be correct before any performance evaluation could mean anything, and the evaluation itself had to be able to price a run, separate a network failure from a model mistake, and record which harness version it measured.

This record builds on [four-tool anchoring and PTC contract refinement](../../implemented/feature/2026-09-12-liangshen-anchor-tools-and-ptc-refinement.md), [workspace instructions in the system prompt](../../implemented/feature/2026-09-12-liangshen-agents-md-in-system-prompt.md), and [minimal persona with an injected tool catalog](../../implemented/feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md). Delivering it partially supersedes the staged-anchor decisions those notes record: anchoring and the promotion boundary are no longer part of the shipped composition, and the preset declares one presentation for the session's whole lifetime.

## Decision

Improve verified task completion while reducing unnecessary tool calls, human intervention, and cost, and settle the default with data rather than assumption. The delivered decision is to **retain the shipped defaults**: the shipped persona and the shipped `presentation: 'both'`. The candidate persona and the `ptc` presentation are not adopted, because the completed comparison found no task-success difference and no cost or latency advantage for either.

The improvement that landed is in the measurement, not the prompt: the evaluation can now price a run in the currency the route bills in, tell a workspace that could not reach a host apart from a model that guessed, and report whether it measured a harness version at all.

## Context & Efficiency Impact

The candidate persona is not shorter than the shipped one in any way that changed an outcome: the completed comparison measured a 0.0pp paired difference in task success with no cost or latency advantage (candidate persona 50.8s and CNY 0.128 against shipped 35.0s and CNY 0.134 over the same three tasks). Token savings alone never established better performance, and here they did not even appear.

The `ptc` presentation does reduce the tool surface the model reaches for: over the same tasks it issued 6.0 tool calls per session against the shipped 'both' presentation's 11.3 and official Minimal's 25.3, and it was the only arm that issued no direct `web_search` or `web_fetch` call at all, reaching those tools inside `run_code` programs instead. That cleanliness did not become an advantage: its output tokens rose to 8,025 per session against 4,938, leaving it slower (54.4s) and slightly more expensive (CNY 0.145) than the shipped default. Cost follows output tokens, which is why this record measures cost in the price book's currency and reports the components separately.

## Implementation stages

### 1. Freeze the baseline and acceptance measures

Every run records the repository commit and dirty state, the shipped preset tree hash, the DSH version, the provider and model route, reasoning effort, platform, Node version, task revision and hash, and the exact variant patch applied. The DSH version is read from the CLI and falls back to the version of the package the `dsh` shim resolves to, because a Windows command shim can answer with its own scripting error instead of a version and that error text must never become a baseline fact.

Independently verified task success is the primary metric; a task is graded by its own Node acceptance check in the task workspace. Runs also record regressions, instruction violations, tool errors, human interventions, elapsed time, token usage, and cost. `we/let me` classification remains diagnostic style data and never an outcome measure.

Completion: the same task repeats in an isolated environment, and the exact configuration difference between groups is inspectable. The isolated run materializes the evaluated preset into a temporary root, redirects session persistence there, and never writes the harness home or a real session history.

### 2. Correct tool-catalog accuracy

[tool-catalog.mjs](../../../../packages/dsh-liangshen/presets/liangshen/tool-catalog.mjs) declares exactly the tools the current request's wire carries, distinguishing the directly callable `run_code` transport from tools reachable through the generated SDK under PTC, and summarizing paged-out namespaces with their `tool_activate` pointer. Paging is enforced on both surfaces — the assembled tool list and the agent scope — so a wire-only filter cannot leave the families reachable through a program dispatch.

Fallback, compaction recovery, and per-session isolation are preserved and covered by [tool-catalog.test.ts](../../../../packages/dsh-liangshen/tests/tool-catalog.test.ts), including first-turn multi-step execution, promotion, an unavailable code runtime, failed presentation, resume, and compaction. A native fallback never continues to advertise PTC.

### 3. Prepare independent prompt and tool-strategy candidates

The comparison varies persona wording and tool presentation independently without adding a user-visible preset. [benchmark-live-run.mjs](../../../../packages/dsh-liangshen/tools/benchmark-live-run.mjs) materializes each variant from the shipped preset tree: group B keeps the shipped persona and presentation, P/T/N apply the candidate persona and vary the presentation, and M mounts the harness bundle's own Minimal preset as an external reference. Group N is the full native roster, not Minimal and not a curated minimal toolset.

The candidate persona and the group definitions live in the runner as evaluation scaffolding. They are not shipped to users, and the shipped composition is unchanged by them.

Completion: prompt wording and presentation vary independently, and no user-visible preset is added.

### 4. Extend the runner and execute staged A/B evaluation

The runs are bounded by session count, timeout, and an explicit cost budget. A budget the run cannot price is refused rather than silently disarmed, because a gate that never triggers understates every result behind it.

The evaluation of 2026-09-25 ran 27 live sessions on the fixed route `deepseek-official/deepseek-flash/max` for CNY 1.21 in total: one protocol smoke session, a seven-task probe of the shipped corpus, a three-task external-verification probe, and the five-arm matrix over those three verification tasks.

| Group | Persona | Tool strategy | Comparison purpose |
| --- | --- | --- | --- |
| B | Shipped | Shipped presentation | Baseline |
| P | Candidate | Shipped presentation | B versus P isolates persona changes |
| T | Candidate | `ptc` presentation | P versus T compares the two presentations |
| N | Candidate | Native roster | T versus N compares presentation |
| M | Official Minimal | Official configuration | External reference, not single-factor attribution |

Result: all five arms passed 15/15 graded tasks, and every paired comparison reported a 0.0pp difference. Group M spent CNY 0.285 and 128.7s per three tasks against group B's CNY 0.134 and 35.0s, so the shipped composition delivered the same verified success at about half the cost and a third of the time of the external reference. No arm produced a failure that a missed lookup caused.

### 5. Select defaults and complete delivery

Defaults are selected in order: verified task success first, then instruction compliance and human intervention, then cost and elapsed time. The measured outcome is a tie on the first two and an advantage to the shipped defaults on the third, so the shipped persona and `presentation: 'both'` remain the defaults. Choosing otherwise on these numbers would trade nothing for a cost increase.

Delivery adds the tooling the evidence required:

- `tools/prices/deepseek-flash.json` states the published row in CNY per million tokens, and the runner prices runs and enforces `--budget-cny` from it.
- A tool result whose error carries a `WEB_*` code counts as a transport failure, reported beside the errors the model caused so an unreachable host cannot read as a model mistake.
- Each run records its research calls and the number of inspections before its first write, which is the guardrail the external `we-need` experiments measured falling from a median of 30 to 6.
- The seed corpus carries external-verification tasks whose facts are published outside the workspace, plus workspace-local authority tasks that keep the same guardrail measurable when the network is not.
- [analyze-session.mjs](../../../../packages/dsh-liangshen/tools/analyze-session.mjs) reports whether the log actually carried reasoning text, because a provider can persist signed reasoning blocks with an empty string and a counter over absent text reads like a measured zero.

The evaluation ran isolated headless sessions and did not interrupt or restart the running DSH service. No shipped preset-composition change was needed, so no restart is required for this delivery.

Completion: the chosen configuration has reproducible evidence, documentation matches the delivered behavior, and the required checks have actual recorded results.

## Evidence references

The [DeepSeek R1 paper](https://arxiv.org/html/2501.12948v1), [DeepSeek V3.2 paper](https://arxiv.org/html/2512.02556v1), [V4.1 Flash technical report](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/DeepSeek_V41_Tech_Report.pdf), and [official V4.1 Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) inform the candidate strategies. These sources do not evaluate this project's composition.

The [anchored-standard source project](https://github.com/xiaobright/dsh-anchored-standard) describes its V4 Pro focus and the limits of its Flash evidence.

The [we-need preset](https://github.com/walksls/not-smarter-just-faster) reports over 20 experiment batches on the same model: prompt wording changed reasoning style and length but never task success, and its speed advantage came mainly from doing less verification. Its findings agree with this comparison and motivate the guardrail metrics above.

The completed run's records are under `packages/dsh-liangshen/.benchmark-results/`, which is not committed; the delivered report for the matrix directory is regenerated by `node tools/benchmark-report.mjs <dir>`.

## Alternatives considered

Adopting the `ptc` presentation as the new default is not selected: it produced the cleanest tool surface of any arm and the fewest model-caused tool errors, but its output-token increase made it slower and more expensive than the shipped default at identical verified success. Its batching benefit may still suit wide fan-out workloads, which is why the presentation stays configurable rather than being removed.

Adopting the candidate persona is not selected: the paired comparison measured no task-success difference and no cost or latency advantage, so changing model-facing wording would carry risk without evidence of a return.

Restoring a 1024-token bootstrap cap or using `we/let me` as a promotion or success signal is not selected: truncation and output style do not establish correctness.

Removing workspace instructions or shortening SDK schemas to reproduce a bare Minimal prompt is not selected: necessary instructions and tool semantics are part of the task contract.

Building a new evaluation framework or registering separate public presets is not selected: the existing runner and configuration fields express the required comparisons with a smaller change.

## Acceptance criteria

- Native and PTC catalog declarations match the actual request surface, including first-turn execution, fallback, resume, and compaction.
- Existing workspace-instruction, plan-mode, SDK-contract, and session-isolation behavior remains covered.
- Every comparison records the source and runtime configuration, uses independently verified outcomes, and keeps style metrics separate.
- The report covers uncertainty, infrastructure failures, cost limits, and the trade-off between quality and resources.
- Default changes follow the stated evidence rule; uncertain results retain the current strategy.
- Documentation pairs, decision records, and applicable validation evidence accompany implementation.

## Risks

Small or unrepresentative task sets may select a configuration that regresses other workloads. Provider routing and model updates can also change results, so runs must record their date and route and stay close enough in time to support comparison.

The matrix isolates selected comparisons but does not establish every interaction between prompt wording and tool presentation.

A budget bound only works while the price book matches what the route charges; a rate change or a peak-hour run makes the recorded cost wrong until the book is refreshed. The published peak doubles the off-peak row this book carries.

The verification corpus depends on facts published outside the workspace, and a workspace that cannot reach those hosts degrades a task from "looked it up" to "could not look it up". The workspace-local authority tasks keep the guardrail measurable without the network, and transport failures are reported separately, but the external tasks are only as stable as the network in front of them.

The three verification tasks are a screening sample, not a stable estimate. All five arms tied on them, so the measurement supports retaining the current defaults rather than proving they are optimal.
