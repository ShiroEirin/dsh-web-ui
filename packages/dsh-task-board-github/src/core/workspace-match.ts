/**
 * Which local workspace a synchronized issue's work belongs in.
 *
 * A card that pins no workspace runs wherever the board's inheritance rules
 * land it: the creating session's workspace, or the most recently used one.
 * For an issue that is neither — a card the sync itself materialized, with no
 * creating session — that is the wrong answer whenever the user works on more
 * than one project, and it is silently wrong: the agent edits a checkout that
 * has nothing to do with the issue.
 *
 * The inference is deliberately conservative and deterministic: a repository
 * name matches a workspace whose DIRECTORY name is the same, and nothing else
 * is consulted. No fuzzy similarity, no "most similar" fallback, no guessing
 * from a remote URL. A miss leaves the pin empty, which is exactly the
 * pre-existing behavior, so an unmatched repository can never be sent
 * somewhere new by this rule.
 *
 * Framework-free and structural, so the rule is unit-testable in isolation.
 *
 * @module dsh-task-board-github/core/workspace-match
 */

/** The workspace facts this rule reads (a host workspace record's subset). */
export interface WorkspaceMatchCandidate {
  /** Stable workspace record id. */
  readonly id: string
  /** Filesystem path the workspace roots at, when the host records one. */
  readonly path?: string
  /** Display name, when the host records one. */
  readonly name?: string
}

/** Longest repository name the rule will match on. */
export const MAX_REPOSITORY_NAME_CHARS = 100

/**
 * The final path segment of a POSIX or Windows path, tolerating both
 * separators and a trailing one.
 * @param path - the workspace path.
 * @returns the directory name, or an empty string when there is none.
 */
export function directoryName(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/u, '')
  if (trimmed === '') return ''
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * The candidate name comparison runs on: lowercase, and with the punctuation
 * GitHub allows in a repository name normalized to one separator.
 *
 * GitHub permits dots and underscores in a repository name, and a developer
 * may well have checked the project out with dashes. Treating those as one
 * separator is what makes the two spellings meet; it is still an equality
 * test, never a similarity score.
 * @param value - a repository or directory name.
 * @returns the comparable form.
 */
export function comparableName(value: string): string {
  return value.trim().toLowerCase().replace(/[._-]+/gu, '-')
}

/**
 * The workspace an issue from one repository should be pinned to.
 *
 * @param repository - the GitHub repository name.
 * @param workspaces - the deployment's workspaces.
 * @returns the workspace id to pin, or undefined when nothing matches.
 */
export function workspaceIdForRepository(
  repository: string,
  workspaces: readonly WorkspaceMatchCandidate[],
): string | undefined {
  const name = comparableName(repository.slice(0, MAX_REPOSITORY_NAME_CHARS))
  if (name === '') return undefined
  const matches: string[] = []
  for (const workspace of workspaces) {
    for (const candidate of [workspace.path, workspace.name]) {
      if (candidate === undefined) continue
      const directory = comparableName(directoryName(candidate))
      if (directory !== '' && directory === name && !matches.includes(workspace.id)) matches.push(workspace.id)
    }
  }
  // An AMBIGUOUS match is a miss. Two checkouts of the same project are a
  // question only the user can answer, and guessing one of them is worse than
  // leaving the card on the board's own inheritance rules.
  return matches.length === 1 ? matches[0] : undefined
}
