# Agent Note: satellite developer skills live in their owning repositories

Status: implemented

## Problem

The skin and pet developer skills described work whose every command runs in the dsh-skins / dsh-pet repositories - scaffolding, contract validation, submission gates, pull requests - but the skills themselves sat in the dsh-web monorepo's `.agents/skills/`. An agent opened in a satellite checkout, where that work actually happens, saw no skill for it, while dsh-web carried step-by-step instructions for repositories it only consumes as published npm packages plus pinned market inputs.

## Decision

- Move `.agents/skills/dsh-web-skin-developer/` into dsh-skins as `.agents/skills/dsh-skin-developer/` and `.agents/skills/dsh-web-pet-developer/` into dsh-pet as `.agents/skills/dsh-pet-developer/`; each satellite commit lands on and is pushed to its own `main`, and dsh-web moves the submodule gitlink in the same change (the satellite three-step flow).
- Rename by dropping the `dsh-web-` prefix: the skill name follows the owning repository.
- dsh-web's `.agents/skills/` keeps `dsh-web-community-plugin-developer` and `dsh-web-release`; the agent-coding routing line and the community skill's whenToUse point at the satellite homes instead of the removed directories.
- The moved skill bodies keep their dsh-web market-side sections (gitlink pinning, `market:fetch --local`, `capture-previews`), because a skin or pet change still reaches users through the market build; links into dsh-web files became GitHub URLs since the skills no longer sit under the dsh-web root.

## Alternatives considered

- Keep both skills in dsh-web so dsh-web sessions keep listing them: rejected - DeepSeek Harness scans the project root, so a skill serves the checkout it lives in; skin and pet authoring starts in the satellite, and dsh-web's root instructions already route content work to the satellites.
- Copy the skills into both repositories: rejected - two homes for one fact drift, the exact problem [the skills-home decision](2026-09-14-repository-skills-agents-home.md) removed.
- Keep the names `dsh-web-skin-developer` / `dsh-web-pet-developer` inside the satellites: rejected - a satellite-owned skill named after the consuming monorepo misstates its own home.

## Consequences

- A session opened in dsh-skins or dsh-pet lists its developer skill natively; a dsh-web session lists neither, and dsh-web's routing notes say where to find them.
- The satellites now version their own contribution guidance next to the contracts and gates it describes, so a satellite-side gate change updates the skill in the same repository and the same pull request.
- The gitlink moves land skill-only commits on top of the previous pins; `skins/` and `assets/` are byte-identical across both moves (verified against each origin/main before moving), so the market inputs and the committed `market/dist` are unaffected.
- [Repository skills resolve from the .agents skills home](2026-09-14-repository-skills-agents-home.md) keeps owning the dsh-web skills root; its four-skill enumeration now covers the two skills that remain here.

## Testing

- `git status` in dsh-web shows the two skill directories deleted and both gitlinks moved, with no other content change.
- `pnpm docs:check` and `pnpm emoji:check` pass.
- `pnpm market:check` passes after the gitlink moves (skill-only satellite commits leave the pinned content directories byte-identical).
