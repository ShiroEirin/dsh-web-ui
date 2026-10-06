/**
 * The platform-dependent arguments the `tar` in PATH needs.
 *
 * GNU tar reads a `C:\...` argument as a remote host spec and needs
 * `--force-local` to keep it a local path. Windows also ships bsdtar
 * (libarchive) as `tar.exe`, which has neither that heuristic nor that flag, and
 * rejects it: `tar: Option --force-local is not supported`. Keying the flag on
 * the platform therefore breaks every tar call on a stock Windows host, which is
 * exactly the machine the release helpers run on. Probe the binary that will
 * actually run instead.
 *
 * `scripts/e2e-mount.sh` keeps its own `uname`-based flag: it only ever runs
 * inside an MSYS/MinGW shell, where the `tar` on PATH is GNU tar by
 * construction, so the capability probe would be ceremony there.
 *
 * CommonJS because `scripts/e2e-mount-rewrite` is a CommonJS CLI; the ESM
 * callers reach these exports through Node's CommonJS named-export detection.
 */
const { execFileSync } = require('node:child_process')

/** Whether the `tar` in PATH accepts the GNU-only `--force-local` flag. */
function forceLocalAccepted() {
  try {
    execFileSync('tar', ['--force-local', '--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The extra arguments this host's tar needs, empty when it needs none.
 * `platform` and `accepts` are injectable so both branches are testable
 * without a particular tar binary on the machine running the tests.
 */
function tarLocalArgs({ platform = process.platform, accepts = forceLocalAccepted } = {}) {
  if (platform !== 'win32') return []
  return accepts() ? ['--force-local'] : []
}

const TAR_LOCAL = tarLocalArgs()

module.exports = { TAR_LOCAL, tarLocalArgs }
