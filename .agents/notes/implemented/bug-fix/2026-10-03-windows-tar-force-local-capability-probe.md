# Agent Note: the tar --force-local flag follows the binary, not the platform

Status: implemented

## Problem

`pnpm test:scripts` failed on a stock Windows host: nine of the sixteen
`scripts/e2e-mount-rewrite` cases aborted with
`tar: Option --force-local is not supported`, so the whole script suite was red
before any of its assertions ran. The suite had been reported green because the
lane that exercises it runs on Linux.

Root cause: the flag was keyed on the platform.
`scripts/e2e-mount-rewrite`, `scripts/e2e-mount-rewrite.test.mjs` and
`scripts/publish-legacy-aggregate.mjs` each carried the same line, added when
[the SDK cohort note](../architecture/2026-09-22-sdk-cohort-0.1.7-alpha.1.md)
recorded that GNU tar reads a `C:\...` argument as a remote host spec:

```js
const TAR_LOCAL = process.platform === 'win32' ? ['--force-local'] : []
```

That is right for the shell the decision was written for and wrong for the one
these three run in. Windows puts two unrelated programs behind the name `tar`:
GNU tar (Git for Windows, MSYS) has the drive-letter heuristic and the flag that
disables it; the bsdtar (libarchive) build that ships in `System32` and is the
`tar` a plain PowerShell or cmd shell resolves has neither, and aborts on the
unknown option. "Platform is Windows" therefore selected the flag for a binary
that rejects it. Nothing about the intent was wrong -- the platform check was
standing in for a capability question, and on Windows those are different
questions.

## Decision

`scripts/tar-args.cjs` answers the capability question directly: on Windows it
asks the `tar` in PATH whether it takes `--force-local`
(`tar --force-local --version`, a read-only probe that GNU tar exits 0 on and
bsdtar exits 1 on) and sends the flag only to a binary that accepted it. Off
Windows the probe never runs, so the Linux lane is byte-for-byte unchanged.

The helper is CommonJS because `scripts/e2e-mount-rewrite` is a CommonJS CLI
invoked by shebang from `scripts/e2e-mount.sh`; the two ESM callers reach its
exports through Node's CommonJS named-export detection, which is why the module
ends in a plain `module.exports = { ... }` assignment.

`scripts/e2e-mount.sh` deliberately keeps its own `uname`-based flag and is not
part of this change: it only ever runs inside an MSYS/MinGW shell, where the
`tar` on PATH is GNU tar by construction, so a capability probe there would be
ceremony in a script whose portability contract is already the `uname` case
statement.

## Testing

- `pnpm test:scripts` is green on this Windows host: 366 tests, 20 suites, 0
  failures, up from 9 failures that aborted before their assertions ran. The
  nine `e2e-mount-rewrite` cases that were red now pass, and
  `publish-legacy-aggregate` and the new `tar-args` suite pass with them.
- `scripts/tar-args.test.mjs` pins the decision with an injected probe: no flag
  off Windows even when the binary would accept one, the flag on Windows when it
  would accept one, and no flag on Windows when it would not. A third case runs
  the real `tar` in PATH with the resolved arguments, which is the one the
  injected branches cannot prove -- on this host it resolves to `[]` and bsdtar
  exits 0 on `tar --version`.
- The helper is the single source: the three former copies are gone, so the
  publish path and the mount smoke can no longer disagree about the flag.

## Alternatives considered

- **Key the flag off the tar implementation rather than probing.** Rejected:
  there is no portable way to ask which tar is in PATH without running one
  (`tar --version` output differs across builds and forks, and Git for Windows
  prepends its own to PATH only inside a Git shell). The option probe is the
  question actually being asked, asked of the binary that will answer it.
- **Always pass `--force-local` and require GNU tar.** Rejected: it breaks the
  stock Windows host that the publish helper also runs on, which is the failure
  this note closes.
- **Never pass the flag, and give tar a relative path or a forward-slash path
  instead.** Rejected: it trades one Windows-specific hack for a path-normalising
  layer across every call site, and it does not help the bsdtar side at all,
  which already reads `C:\...` as local.
- **Port the tar calls to a Node archive library.** Rejected: the helpers shell
  out for a reason -- they operate on the exact tarballs `pnpm pack` produced, and
  a second implementation of pack/unpack semantics is a much larger surface than
  one argument list.
- **Renaming `scripts/e2e-mount-rewrite` to `.mjs` so one ESM helper serves all
  callers.** Rejected as scope creep on a release-critical CLI: it would touch
  `e2e-mount.sh`, the note that owns the cohort's smoke contract, and the shebang
  invocation, for a change whose whole content is one argument list.

## Consequences

- The script suite is runnable on a Windows workstation, which it was not: every
  `e2e-mount-rewrite` case had been unreachable there, so the pack/extract/
  repack path the release helpers depend on had no local evidence at all.
- One extra read-only `tar --version` spawn per process on Windows, once at
  module load. It replaces three copies of a constant that could each drift.
- The probe is a behavioural dependency, not just a portability nicety: a tar
  that accepts unknown options silently would receive the flag and keep working,
  and one that rejects them loudly is exactly the case the probe covers. A future
  tar that changes its option handling shows up as the `tar-args` suite's real
  binary case failing, not as a silent behaviour change in the publish path.
- `scripts/e2e-mount.sh` remains the one place where the flag follows the shell
  rather than the binary, and that asymmetry is deliberate: it is documented in
  the helper's own header so the next reader does not "fix" it.
