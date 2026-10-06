# Agent Note: The Skill Center Lists What the Official Provider Loads

Status: implemented

## Problem

The skill center merged a filesystem scan with the `ctx.skills` registry, but the scan applied its
own acceptance and precedence rules instead of the official ones. The panel therefore disagreed
with the model catalog in both directions, and a duplicate name could display a skill the model
never receives.

Three defects in `packages/dsh-skill-explorer/src/collect.ts` and `src/routes.ts` produced it:

1. **Acceptance.** The scan listed any directory holding a `SKILL.md`, falling back to the
   directory name when the frontmatter declared no `name`, and rendering `(no description)` when
   it declared no `description`. The official `dsh-skill-filesystem` provider discards a file
   that is missing frontmatter or either field (`stringField` requires a non-empty string), and
   discards an invalid name.
2. **Name grammar.** The panel validated names with `/^[a-z0-9][a-z0-9-]*$/`, written
   independently in `routes.ts` and `collect.ts`. The official `isSkillName` is
   `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. `a-`, `a--b` and `a-b-` passed the panel and fail the
   registry, so the create route could author a skill the harness never loads.
3. **Precedence.** The scan let a filesystem entry win every duplicate name outright and consulted
   the registry only to fill `whenToUse` and invocation flags. The official registry resolves a
   duplicate within one layer by source rank: project `.dsh/skills` 100, project
   `.agents/skills` 200, runtime 250, custom 300, user `~/.dsh/skills` 400, user
   `.agents/skills` 500, bundled 600. A user skill (500) and a runtime registration (250) of the
   same name have different winners in the panel and in the model.

Observed live on a running desktop instance: two files with no frontmatter at all —
`futures-risk-checklist` and `global-risk-checklist` under a project `.agents/skills` — were
listed with `(no description)` and `modelInvocable: true`, while the official provider loaded
neither. The existing suite pinned that behavior: a fixture named `zebra-skill` asserted the
`(no description)` fallback.

## Decision

The scan accepts, names and ranks skills by the official rules, and the write routes share one
name definition with it.

1. `scanSkillRoot` skips a file whose frontmatter yields no non-empty `name` or `description`,
   and skips a name that fails the official grammar. There is no directory-name fallback and no
   `(no description)` placeholder for a scanned file.
2. `collect.ts` exports `isSkillName` backed by the official pattern, and `routes.ts` calls it
   at every name check instead of holding a second copy. A name the panel accepts is one the
   registry loads.
3. `SKILL_SOURCE_RANK` carries the official rank per source, and the registry merge compares it
   against a scanned entry's rank: a weaker registry candidate is ignored, a stronger one replaces
   the entry, and an equal-rank candidate refines `whenToUse`, `provider` and a stated invocation
   policy as before. The scan's own cross-root merge uses the same table.
4. The user `.dsh/skills` root skips the reserved `.system` entry, as the official provider does.

The panel keeps its create capability; only the accepted grammar narrows to the official one.

## Positioning and contract boundary

This is a pure GUI management layer over the official skill subsystem: it reads the official roots
and the official registry, and it writes only SKILL.md files the official provider would itself
load. It does not register a provider, ship skill content, or change loading or injection.

The panel's coverage is exactly: the filesystem roots it scans, plus the global layer of
`ctx.skills` (bundled and runtime entries). A skill that reaches an agent only through an agent
preset's own `customSkillDirs` or a preset-scoped provider is outside that coverage, because the
panel reads the registry without a viewing scope. A skill absent from the panel is therefore not
necessarily absent from the model; the official `skill` tool catalog is the authority on what a
session can load. Closing that gap would require reading the registry per agent scope, which no
panel-side handle exposes, so the boundary is documented rather than bridged.

This note owns skill-catalog alignment for the skill center. The invocation-policy rule it builds
on is owned by [Omitted Invocation Fields Mean Invocable in the Skill Center](2026-10-03-skill-explorer-invocation-omission-means-allowed.md);
the workspace presentation is owned by
[Skill Explorer multi-workspace presentation and isolation awareness](../feature/2026-09-07-skill-explorer-workspace-isolation.md).
Neither decision is superseded.

## Official contract this follows

Verified against the DSH 0.2.0-rc.2 sources:

- `dsh-skill` `isSkillName`: `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
- `dsh-skill-filesystem` `parseSkillFile`: warns and returns `undefined` when frontmatter is
  absent, when `name` or `description` is not a non-empty string, or when `isSkillName(name)` is
  false.
- `dsh-skill-filesystem` rank constants: `PROJECT_DSH_RANK = 100`, `PROJECT_AGENTS_RANK = 200`,
  `CUSTOM_RANK = 300`, `USER_DSH_RANK = 400`, `USER_AGENTS_RANK = 500`,
  `BUNDLED_SKILL_RANK = 600`; `dsh-skill` `RUNTIME_RANK = 250`.
- `dsh-skill-filesystem` `roots()`: the user `.dsh/skills` root carries `skipSystem: true`.

## Alternatives considered

**Read the official acceptance result from `ctx.skills` instead of re-deriving it.** Rejected for
the reason the invocation note records: the web profile mounts `skill-filesystem` only at the
agent-preset scope layer, so the host plane cannot read project or user skills from the registry.
The scan is load-bearing.

**Replace the panel's parse with a value import of `@deepseek-ai/dsh-skill-filesystem`.** Rejected:
its entry points export the provider plugin, not the parsing helpers, and the package is a runtime
peer the panel does not depend on. Importing it would add a dependency for two pure regex checks
and a normalization the provider does not export. The rules are mirrored instead, with the
official source named in the code comment.

**Widen `isSkillName` to a superset so the panel accepts anything the registry might.** Rejected:
the truth direction is the opposite. A name the panel accepts but the registry rejects produces a
skill that silently never loads, which is the failure this note removes.

**Make the panel enumerate agent-preset scopes so its catalog matches the model exactly.**
Rejected: the panel holds no per-agent scope key, and manufacturing one would invent a mechanism
the official registry does not offer to a host-plane reader. The boundary is documented instead.

## Consequences

- The panel and the model catalog agree on acceptance, naming and duplicate resolution for every
  root the panel covers; the two live phantom entries disappear.
- A file that merely sits in a skill root without valid frontmatter is no longer listed, which is a
  user-visible reduction in the list.
- The create and edit routes can no longer author or accept a name the registry would reject.
- `tests/collect.spec.ts` drops the `(no description)` assertion that pinned the defect and keeps
  the no-frontmatter file as the regression input.

## Testing

`packages/dsh-skill-explorer/tests/collect.spec.ts` adds five cases: a file the official provider
discards is absent; the shared name guard matches the official grammar on accept and reject
samples; a runtime registration outranks a same-name user skill; a project skill still outranks a
same-name bundled candidate and keeps its editable path; and the reserved `.system` directory is
never listed. `tests/routes.spec.ts` adds the write-boundary case: the create route refuses
`bad-`, `bad--name` and `a-`, names the panel's former grammar accepted and the registry rejects.
The full package suite passes (134 tests), and each new case fails against the pre-fix source it
covers.
