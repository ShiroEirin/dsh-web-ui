# Agent Note: PR maintenance run 2026-09-23 (twentieth pass) — close the 14 pre-split content PRs with satellite redirects

Status: implemented

## Problem

Twentieth maintenance pass on `zhu1090093659/dsh-web`, following the [nineteenth pass](2026-09-23-pr-maintenance-nineteenth-pass.md). The satellite split recorded in [Family satellite repositories](../architecture/2026-09-23-family-satellite-repositories.md) moved skins, pets and the community plugin index out of this repository, and `reject-non-content-pr.yml` now auto-closes newly misdirected PRs — but that workflow only triggers on `opened` / `reopened` / `edited` / `ready_for_review`, so the 14 PRs submitted before the split were still open. Every one of them touches content whose paths no longer exist on `dev`, so none could ever merge here. The requested scope was the default one (open PRs assigned to `zhu1090093659`, no Issue scan): notify those PRs to move to the satellite repositories, and update the `pr-issue-maintenance` skill so future runs route by the satellite layout.

## Decision

All 14 PRs were closed with one Chinese redirect comment each. The user confirmed comment-plus-close, which matches how `reject-non-content-pr.yml` already handles new misdirected PRs.

- Five skin PRs (`#1679`, `#1671`, `#1659`, `#1603`, `#1607`) redirect to [dsh-skins](https://github.com/zhu1090093659/dsh-skins) `skins/<id>/` with `pnpm skin-center:check`; nine community-index PRs (`#1689`, `#1684`, `#1681`, `#1666`, `#1626`, `#1526`, `#1488`, `#1479`, `#1399`) redirect to [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins) `community.json` with `pnpm community:check`.
- Every comment states the target repository, the submission path and check command, that `market/dist` artifacts are not carried over, and that prior review progress carries over when the new PR links back to the closed one.
- Three comments carry per-PR specifics: `#1659` answers the author's pending question about a wrong author email (set `git config user.email` before committing in the new repo); `#1488` reminds that `subcategory` is a required field in the new index; `#1666` reminds the author to carry the `npm` field they added on 2026-09-23.
- `#1607` was closed with a confirmation rather than instructions: its author had already migrated to [dsh-skins#1](https://github.com/zhu1090093659/dsh-skins/pull/1) and explicitly authorized closing the original PR.

The `pr-issue-maintenance` skill was updated in the same run:

- `pr-review-common.md` gained a `卫星仓（内容仓）` section: what each satellite carries, that their integration branch is `main`, that misdirected PRs in dsh-web are auto-closed by `reject-non-content-pr.yml` while pre-split leftovers are handled manually with a redirect comment plus closure, and that listing on dsh-market.com still requires the dsh-web gitlink move plus a market rebuild.
- The content gate's stale in-repo paths (`packages/skins/skin-center/skins/`, `packages/dsh-pet/assets/`, `packages/dsh-pet/THIRD_PARTY_NOTICES.md`) now point at the satellite repositories; the gates themselves are unchanged.
- The stale common-rules path `~/.dsh/skills/pr-issue-maintenance/pr-review-common.md` was corrected to `~/.agents/skills/pr-issue-maintenance/pr-review-common.md` in both `pr-issue-maintenance/SKILL.md` and `existing-feature-improvement/SKILL.md`, which share the file.

## Alternatives considered

Commenting without closing was rejected: the PRs' target paths no longer exist in this repository so none can ever merge, the automation closes new equivalents on sight, and open-but-unmergeable PRs would keep authors rebasing onto a tree that cannot accept their content.

Migrating the content ourselves — the maintainer moving the skins and index entries into the satellites — was rejected: the contributions are the authors' own work, the copyright declarations belong to the contributors by rule, and the review relationship continues cleanly when each author opens their satellite PR with a link back.

Updating only `SKILL.md` was rejected: the shared gates live in `pr-review-common.md`, which both skills read; editing only one file would leave the content gate pointing at deleted paths and the sibling skill resolving a nonexistent common-rules location.

## Consequences

dsh-web has zero open PRs left over from before the split, and new misdirected content PRs are auto-closed by the workflow. Review continuity is a convention rather than a mechanism: the new satellite PR links back to the closed dsh-web PR and prior verdicts carry over — already demonstrated by binlecode moving `#1607` to dsh-skins#1 before this pass ran.

Skin, pet and community-index reviews now happen in the satellite repositories on their `main` integration branches, with the same content gates and the same three-way plugin assessment applied there. A merged satellite PR does not by itself change the Workshop: listing still requires moving the submodule gitlink in dsh-web and rebuilding `market/dist`, which remains maintainer work in this repository.

The skill now routes content contributions by repository instead of by in-repo path, and `pr-issue-maintenance` resolves `pr-review-common.md` at its real location under `~/.agents/skills/`. (2026-09-24: `existing-feature-improvement`, the sibling skill that previously shared the common-rules file, has been retired and removed; the file now belongs to `pr-issue-maintenance` alone.)

A supersession check found the satellite layout itself is owned by [Family satellite repositories](../architecture/2026-09-23-family-satellite-repositories.md), which stays the Owning Note for the split; this note owns only the twentieth-pass disposition and the skill routing update, and the two are cross-linked rather than consolidated. No earlier note is superseded.

## Testing

Authoritative state after the pass, from `gh` (not local logs): `gh pr list --state open` on `zhu1090093659/dsh-web` returns zero open PRs, and each of the 14 closures carries the redirect comment posted from the `zhu1090093659` account. The satellite repositories were confirmed to already receive the redirected flow: dsh-skins#1 (from `#1607`), dsh-community-plugins#1 and #2 exist and target their `main` branches.

The skill edits were verified by reading back both changed files and by a grep across `~/.agents/skills` confirming no remaining reference to `~/.dsh/skills` or to the deleted in-repo content paths.

Not verified: no satellite PR was reviewed in this pass (dsh-skins#1 and dsh-community-plugins#1/#2 await their own passes under the updated rules), and no contributor has yet acted on the redirects.
