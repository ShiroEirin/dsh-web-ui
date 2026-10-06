# Agent Note: The Skill Center Manages the Custom Roots the Provider Row Declares

Status: implemented

## Problem

The skill center groups a skill by the `source` the `ctx.skills` registry reports for it. A skill
the official `dsh-skill-filesystem` provider discovered under a `customSkillDirs` root therefore
rendered in the "Custom directories" group — but with no enable switch, no edit action, no delete
action, and no path line. Every one of those controls was silently absent, and the write routes
answered `404 {"error":"skill <name> has no editable file"}`.

The panel's editable path comes only from its own filesystem scan (`collect.ts`), while the registry
supplement deliberately exposes no path (a registry entry is not a scanned file). So the group was
populated entirely by pathless registry entries and the write routes' fresh-scan identity check
(`resolveScannedSkill`) could never match one.

Why the scan never saw the roots: the plugin read `customSkillDirs` from its **own** config alone.
The official documentation puts the setting on the **`skill-filesystem` provider row** in the
profile patch, and the shipped web profile does exactly that (`presets/cordis.patch.yml` declares a
bundled skills directory that way). The host-plane plugin config therefore stayed empty, no custom
root was scanned, and the group held nothing but registry entries.

A second, independent defect sat in the write routes: they resolved their workspace with
`DEFAULT_CWD()` (`process.cwd()`) alone, while the list route resolved it as explicit `?cwd=`,
then the active session workspace, then the process cwd. The web server process runs from the DSH
install directory, so on any host whose cwd was not the session workspace the write routes re-scanned
a different project root than the list route had just served and reported `409 ... refresh and
retry` for a skill the panel was displaying.

## Decision

The scan reads `customSkillDirs` from this plugin's own config **and** from every live
`skill-filesystem` loader row, and the write routes resolve the workspace through the same helper
the list route uses.

1. `collect.ts` exports `customSkillDirsFromLoader(entries)`, which walks the live loader entries,
   selects the rows whose module specifier is `@deepseek-ai/dsh-skill-filesystem` (or a
   `.../dsh-skill-filesystem` sub-path), and reads the `customSkillDirs` string array off both
   `entry.options.config` (the raw profile patch) and `entry.fiber.config` (the resolved config,
   where the loader has already interpolated any `!!js` expression). Enumeration failures degrade to
   an empty contribution rather than failing the scan.
2. `collect.ts` exports `normalizeSkillRoots(dirs)`: it drops blanks, resolves each entry with
   `resolve()`, and de-duplicates. The official provider resolves its configured roots the same way,
   so the scanned identity equals the path the write routes later re-resolve.
3. `index.ts` combines the plugin's own config with the loader-derived roots and passes a resolver
   (not a frozen array) to the routes, because a profile reload can replace the rows between
   requests. The loader is read non-strictly and guarded, since it is not a declared dependency of
   this plugin.
4. `routes.ts` resolves the workspace through `panelCwd(override)` — explicit override, then the
   active session workspace, then the process cwd — and uses it for the list route, the health
   probe, and every `resolveScannedSkill` call. The two halves can no longer disagree.
5. A listed skill with no local file carries a "No local file" badge and an explanatory line
   instead of rendering a row whose controls are silently missing.

## Scope

Only host-plane `skill-filesystem` rows contribute roots, because only those are loader entries the
host can enumerate. A skill that reaches an agent solely through an agent preset's own
`customSkillDirs` or a preset-scoped provider stays outside the panel, exactly as
[The Skill Center Lists What the Official Provider Loads](2026-10-03-skill-center-lists-official-loadable-skills.md)
records; this change narrows that documented gap for the documented placement without claiming to
close it.

## Alternatives considered

**Keep `serializeRegistry` from trusting `resourceBase.path`.** The registry reports a
`resourceBase` directory for filesystem-discovered skills, so a custom entry could have been given a
path without scanning anything. Rejected: the write routes' whole safety property is that they only
mutate a path a **fresh scan** produced (see the package README's security model), so a registry
path would have to be re-validated by a scan anyway. Trusting it without that check would let a
stale registry entry aim a write at an arbitrary directory, and trusting it *with* the check is the
scan this change implements — minus the ability to discover the roots at all.

**Enumerate agent-preset scopes so the panel's catalog matches the model exactly.** Rejected for the
reason the owning note already records: the panel holds no per-agent scope key and reads the
registry without a viewing scope. Manufacturing one would invent a mechanism the official registry
does not offer a host-plane reader.

**Read the profile patch file directly.** Rejected: it would duplicate the loader's composition,
interpolation, and layering rules (profile patch, bundle patch, user overrides, `!!js` evaluation)
in a second implementation that could silently disagree with what actually loaded.

**Mirror the official provider's rank table instead of scanning the row's roots.** Not applicable:
the rank table already existed and was correct. The defect was never precedence; it was that the
root was never scanned, so no filesystem entry existed to outrank or to carry a path.

## Consequences

- A skill under a `customSkillDirs` root declared on the provider row is listed in the custom group
  with a real path, and its switch, editor, and delete action work against its own SKILL.md.
- The two halves of the route family resolve one workspace, so a project skill stays manageable
  regardless of the host process cwd.
- A bundled or runtime registration no longer looks like a broken row: it states that it has no
  local file.
- A root declared in both places is scanned once, and relative entries resolve to absolute paths as
  the official provider resolves them.

## Testing

`tests/collect.spec.ts` adds five cases: the provider row's roots are scanned with an editable
path; blank/duplicate/relative roots normalize to one absolute list; a non-`skill-filesystem` row
contributes nothing; an entry tree that throws degrades to an empty contribution; and a root present
only in the resolved `fiber.config` is read. `tests/routes.spec.ts` adds five cases: the list
route serves a row-configured custom skill with its path; set-enabled returns 200 instead of the
reported 404 and writes the frontmatter; delete moves it to `.trash`; a throwing resolver still
serves a list; and a project skill is toggleable when the process cwd is a different project holding
a same-name skill (the write route must not answer 409). `tests/host-apply.spec.ts` adds the
end-to-end case: a fake host whose loader carries the provider row serves that root's skill with its
path through the real route. All eleven fail against the pre-fix source; the package suite passes
(145 tests).
