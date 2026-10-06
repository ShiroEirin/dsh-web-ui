# Agent Note: Omitted Invocation Fields Mean Invocable in the Skill Center

Status: implemented

## Problem

The skill center listed every skill as not invocable ("not available / name - not model invocable"),
including skills whose SKILL.md frontmatter declares neither `user-invocable` nor
`disable-model-invocation`. A 50-skill installation reported 50 false negatives; no skill was
actually disabled, so the display contradicted the host's real invocation decision and made a
healthy installation look entirely broken.

Two defects in `packages/dsh-skill-explorer/src/collect.ts` produced it:

1. `serializeRegistry()` defaulted a missing registry policy to `false`:
   `modelInvocable: skill.invocation?.modelInvocable ?? false`. The official rule is the
   opposite — omission permits the surface.
2. `collectSkills()` then assigned those serialized values onto every same-name filesystem entry
   unconditionally, discarding the correct values `scanSkillRoot()` had already parsed from the
   file with the official rule (`parsed.disableModelInvocation !== true`,
   `parsed.userInvocable !== false`).

The display was the only affected surface: the host decides real invocability through the official
registry (`isModelInvocable(skill) => skill.invocation.modelInvocable`), so every skill remained
usable while the panel claimed otherwise.

## Decision

The skill center treats an absent invocation policy as "allowed", matching the official semantics,
and never lets a registry default overwrite a value parsed from the file.

1. In `serializeRegistry()`, a registry entry without an `invocation` policy defaults to
   `modelInvocable: true` / `userInvocable: true`. This matches `ctx.skills.register()`, which
   defaults an omitted policy to `{ modelInvocable: true, userInvocable: true }`, and
   `dsh-skill-filesystem`, whose `parseInvocationPolicy()` resolves
   `disableModelInvocation !== true` and `userInvocable !== false`.
2. In `collectSkills()`, the registry merge now refines `modelInvocable` / `userInvocable` only
   when the registry candidate actually states that field, so a policy-less candidate leaves the
   parsed frontmatter values intact. `whenToUse` and `provider` keep their existing
   fill-if-present behavior.

The source of truth for a skill with an editable file remains the file's own frontmatter, parsed by
this package's `parseFrontmatter()`; the registry is a supplement, not an authority that overrides
what the file declares.

## Official contract this follows

Verified against the DSH 0.2.0-rc.2 sources:

- `dsh-skill` `register()`: `invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true }`.
- `dsh-skill-filesystem` `parseInvocationPolicy()`: `modelInvocable: disableModelInvocation !== true`,
  `userInvocable: userInvocable !== false`.
- `validateInvocation()` returns early for `undefined`, so a provider may legitimately return a
  candidate with no `invocation` at all; that silence means allowed, never denied.

One correction to the upstream report: the report theorized that `snapshot()` is invocation-neutral
and therefore never carries `invocation`. At rc.2 it does — `toSummary()` copies `invocation`
onto every summary. The observed failure came from providers that omit the field plus the inverted
fallback, not from a field the registry structurally drops.

## Alternatives considered

Taking invocation from `ctx.skills.get(name)`, which returns a full `SkillDefinition` carrying
`invocation`, instead of merging the registry snapshot. This would make the official registry the
single source of truth. It was rejected because `get()` loads and validates the full skill body per
name: the list route would perform one file read plus validation per skill on every poll, and would
gain nothing for skills whose file this package has already parsed. The panel still needs its own
scan for path, level, workspace and linked-skill data that no registry summary carries, so the
parse stays either way.

Replacing the filesystem scan entirely with `ctx.skills.list()`. The web profile mounts the
skill-filesystem provider only at the agent-preset scope layer, so the host plane cannot read
project or user skills from the registry; the scan is load-bearing, not a convenience.

Keeping the registry snapshot as the authority and merely flipping the fallback to `true`. That
fixes the reported symptom for policy-less entries but leaves a real precedence bug: a registry
candidate that does state a policy would still override the file's own frontmatter, and a
stale or mismatched registry would silently contradict the file the panel edits. Gating the
override on the field being present fixes both.

## Consequences

- The skill center no longer reports a healthy skill as disabled, and a genuinely disabled skill
  still shows as disabled through its explicit frontmatter field.
- A skill that only a registry plugin declares as non-invocable still displays correctly, because
  the registry still refines the flags when it states them.
- The bug was display-only, so no host invocation behavior changes; the two defaults now match the
  official rule instead of contradicting it.

## Testing

`packages/dsh-skill-explorer/tests/collect.spec.ts` locks the behavior in five cases: omitted
fields stay invocable, explicit fields are honored, a policy-less registry entry leaves parsed
values untouched, an explicit registry policy still refines an entry, and registry-only skills
default to invocable while an explicitly denied one stays denied. The suite passes 128 tests, and
the new cases fail against the pre-fix `collect.ts`.
