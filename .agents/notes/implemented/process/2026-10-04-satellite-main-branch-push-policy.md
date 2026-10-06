# Agent Note: Satellite main branches require a pull request except for the owner and collaborators

Status: implemented

## Problem

The four content repositories — dsh-skins, dsh-pet, dsh-community-plugins and dsh-presets — accepted commits on `main` from every account with write access. None carried a branch ruleset, so a change reached the branch the market build pins without a pull request and without the repository's own CI ever running on the commit that shipped. The [satellite split](../architecture/2026-09-23-family-satellite-repositories.md) moved skin, pet, community-index and preset contributions into those repositories so outside contributions would land there; an open `main` let that content arrive ungated.

## Decision

Each satellite's `main` carries an active ruleset named `main-branch-policy`, and only the repository owner plus the collaborators holding write access keep a direct-push bypass.

- The ruleset applies `pull_request`, `required_status_checks`, `non_fast_forward` and `deletion` to `refs/heads/main`.
- The pull-request rule requires no approving review, matching the family's merge policy: a pull request is mandatory, an approval is not.
- The required check is that repository's own CI job — `skin catalog, typecheck, test and build` (dsh-skins), `migrate script, typecheck, test and build` (dsh-pet), `community index gate, typecheck, test and build` (dsh-community-plugins) and `preset catalog gate, typecheck, test and build` (dsh-presets) — so a merge waits on a green gate for the pull request.
- `bypass_actors` names the owner (`zhu1090093659`) in every repository and the collaborator `Aa728848` in the three where that account holds write. The bypass keeps the documented maintainer flow working: a maintainer moves content from a `satellites/<repo>` checkout with `git -C satellites/<repo> push origin main`.
- A contributor without write access opens a pull request against `main` in the satellite repository, which is the flow each repository's CONTRIBUTING.md already describes.

## Alternatives considered

**Classic branch protection instead of a ruleset.** Rejected: this repository already states the same policy for its integration branches as the `integration-branch-policy` ruleset on dsh-web, and a ruleset makes the bypass list and the required checks an explicit object rather than implicit protection settings.

**Bypass by repository role rather than named users.** Rejected: GitHub does not document which `RepositoryRole` actor id maps to which role. A probe against the API confirmed it accepts ids 2, 4 and 5 and rejects 1 with "Actor base role does not have write permissions", but nothing published says which of 2/4/5 is admin, maintain or write, so a role-based bypass could grant or deny the wrong set with no visible signal. Named users are verifiable and follow the existing dsh-web ruleset.

**Require one approving review.** Rejected: the family's merge policy already leaves review optional once checks are green, and this decision exists to force every content change through a pull request and its gate, not to add a reviewer bottleneck.

**Require no status check.** Rejected: a pull request that fails the satellite's own gate would then merge, which is the case the protection exists to prevent.

**Protect every branch, or restrict branch creation.** Rejected as beyond the goal: `main` is the integration branch the market pins, and feature branches stay unconstrained.

## Consequences

- Every satellite change now arrives as a pull request with the repository's CI check green, or as a direct push from the owner or a write collaborator.
- The maintainer flow in [CONTRIBUTING.md](../../../../CONTRIBUTING.md) is unchanged for its intended audience, because both bypass accounts keep their direct push.
- dsh-presets lists only the owner in `bypass_actors`: Aa728848 holds read there, not write. Granting that account write would mean adding it to the ruleset.
- A satellite that renames its CI job also breaks its required check: the context is the job's `name`, a renamed context never reports, and merges then block until the ruleset names it again.
- Force pushes and deletion are blocked for every account without bypass, so rewriting a satellite `main` now goes through the bypass path.
- Verification is the ruleset read back from the GitHub API — active enforcement, the four rules, the required check context and the bypass list — plus the effective-rules endpoint for `main`. The block itself was not exercised from a non-bypass account in this session.
