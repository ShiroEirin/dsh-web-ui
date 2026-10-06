/**
 * GitHub provider surfaces: the sections rendered into the board's child
 * seats, plus the summary block the extension's own settings card mounts.
 *
 * These components are the provider's browser half: they receive the board's
 * seat owner props ({ task, dispatch }) and talk back only through `dispatch`,
 * never through a board internal or an HTTP surface of their own. The
 * repository/credential summary arrives through the board mirror (see
 * ./summary.ts) rather than through a seat.
 *
 * @module dsh-task-board-github/client/github/sections
 */
import { useState } from 'react'
import {
  type TaskBoardDetailSectionProps,
  type TaskBoardExtensionDispatch,
} from '../../core/contract.ts'
import type { TaskRecord } from '../../core/task-record.ts'
import { GITHUB_EXTENSION_ID, readTaskGitHubMetadata, type GitHubTaskMetadata } from '../../core/types.ts'
import { formatHostTimestamp } from '../format-host-time.ts'
import { t, type TaskBoardGithubKey } from '../locales.ts'
import type { GitHubSummary } from './summary.ts'
import { GitHubPromptPanel } from './prompt-panel.tsx'
import css from '../github.module.css'

/** Report a dispatch failure the way the action channel phrased it. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function CreatePrModal({ dispatch, metadata, task, onClose }: {
  dispatch: TaskBoardExtensionDispatch
  metadata: GitHubTaskMetadata
  task: TaskRecord
  onClose: () => void
}) {
  const [headBranch, setHeadBranch] = useState(`issue-${String(metadata.issueNumber)}`)
  const [baseBranch, setBaseBranch] = useState('main')
  const [draft, setDraft] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const handleCreate = async (): Promise<void> => {
    if (headBranch.trim() === '') return
    setLoading(true)
    setError(undefined)
    try {
      await dispatch({
        extensionId: GITHUB_EXTENSION_ID,
        action: 'create-pr',
        taskId: task.id,
        payload: {
          headBranch: headBranch.trim(),
          ...(baseBranch.trim() === '' ? {} : { baseBranch: baseBranch.trim() }),
          draft,
        },
      })
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.modal} role="dialog" aria-label={t('detail.createPrTitle')}>
        <h3 className={css.modalTitle}>{t('detail.createPrTitle')}</h3>
        <div className={css.modalBody}>
          {error !== undefined && <p className={css.formError}>{error}</p>}
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('detail.headBranch')}</span>
            <input
              type="text"
              className={css.input}
              value={headBranch}
              placeholder={t('detail.headBranchPlaceholder')}
              onChange={event => setHeadBranch(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('detail.baseBranch')}</span>
            <input
              type="text"
              className={css.input}
              value={baseBranch}
              onChange={event => setBaseBranch(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className={css.scheduleToggle}>
            <input
              type="checkbox"
              checked={draft}
              onChange={event => setDraft(event.target.checked)}
              disabled={loading}
            />
            <span>{t('detail.prDraft')}</span>
          </label>
        </div>
        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button type="button" className={css.primaryButton} onClick={() => { void handleCreate() }} disabled={loading || headBranch.trim() === ''}>
            {loading ? t('detail.refreshing') : t('detail.createPr')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function LinkPrModal({ dispatch, task, onClose }: {
  dispatch: TaskBoardExtensionDispatch
  task: TaskRecord
  onClose: () => void
}) {
  const [prNumber, setPrNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const handleLink = async (): Promise<void> => {
    const number = Number(prNumber)
    if (!Number.isInteger(number) || number <= 0) return
    setLoading(true)
    setError(undefined)
    try {
      await dispatch({
        extensionId: GITHUB_EXTENSION_ID,
        action: 'link-pr',
        taskId: task.id,
        payload: { pullRequestNumber: number },
      })
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.modal} role="dialog" aria-label={t('detail.linkPrTitle')}>
        <h3 className={css.modalTitle}>{t('detail.linkPrTitle')}</h3>
        <div className={css.modalBody}>
          {error !== undefined && <p className={css.formError}>{error}</p>}
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('detail.prNumberInput')}</span>
            <input
              type="number"
              className={css.input}
              value={prNumber}
              min="1"
              onChange={event => setPrNumber(event.target.value)}
              disabled={loading}
            />
          </label>
        </div>
        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => { void handleLink() }}
            disabled={loading || !Number.isInteger(Number(prNumber)) || Number(prNumber) <= 0}
          >
            {loading ? t('detail.refreshing') : t('detail.linkPr')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** The repository/credential summary block the extension's settings card renders. */
export function GitHubSummaryBlock({ summary }: { summary: GitHubSummary | undefined }) {
  if (summary === undefined) {
    return <p className={css.detailMeta} style={{ margin: '4px 0' }}>{t('summary.notRunning')}</p>
  }
  const repositories = summary.repositories ?? []
  return (
    <div>
      {repositories.length > 0 ? (
        <div>
          <p style={{ margin: '4px 0', fontSize: '12px' }}>
            {t('summary.repositories', { count: String(repositories.length) })}:
          </p>
          <ul style={{ margin: '4px 0 8px 16px', padding: 0, fontSize: '12px' }}>
            {repositories.map(repository => (
              <li key={`${repository.owner}/${repository.repository}`}>
                <strong>{repository.owner}/{repository.repository}</strong>
                {' · '}{t('summary.label')}: <code>{repository.inclusionLabel}</code>
                {repository.prCreationEnabled ? ` · ${t('summary.autoPr')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={{ margin: '4px 0 8px 0', fontSize: '12px', opacity: 0.8 }}>
          {t('summary.noRepositories')}
        </p>
      )}
      <p style={{ margin: '4px 0', fontSize: '12px', opacity: 0.8 }}>
        {summary.hasCredential === true ? t('summary.credentialReady') : t('summary.credentialMissing')}
      </p>
    </div>
  )
}

/** The task-detail seat: the issue, its labels and its pull request. */
export function GitHubDetailSection({ task, dispatch }: TaskBoardDetailSectionProps) {
  const metadata = readTaskGitHubMetadata(task)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreatePr, setShowCreatePr] = useState(false)
  const [showLinkPr, setShowLinkPr] = useState(false)
  const [error, setError] = useState<string | undefined>()

  if (metadata === undefined) return null

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    setError(undefined)
    try {
      await dispatch({ extensionId: GITHUB_EXTENSION_ID, action: 'refresh', taskId: task.id })
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className={css.detailSection} data-dsh-part="github-integration">
      <h4>{t('detail.title')}</h4>
      {metadata.deactivated === true && (
        <p className={css.formError}>{t('detail.deactivated')}</p>
      )}
      <div className={css.detailText} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <a
          href={metadata.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={css.linkButton}
          data-dsh-part="github-link"
          title={metadata.issueUrl}
        >
          {metadata.owner}/{metadata.repository} #{metadata.issueNumber}
        </a>
        <span className={css.statusBadge} data-status={metadata.remoteState === 'closed' ? 'done' : 'todo'}>
          {t(`detail.state.${metadata.remoteState ?? 'open'}` as TaskBoardGithubKey)}
        </span>
      </div>

      {metadata.remoteLabels.length > 0 && (
        <div className={css.cardTags} style={{ marginTop: '6px' }}>
          {metadata.remoteLabels.map(label => (
            <span key={label} className={css.cardTag} data-dsh-part="github-label" title={label}>
              {label}
            </span>
          ))}
        </div>
      )}

      {metadata.pullRequest !== undefined && (
        <div className={css.detailText} data-dsh-part="github-pr" style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>{t('detail.pr')}:</span>
          <a href={metadata.pullRequest.url} target="_blank" rel="noopener noreferrer" className={css.linkButton} title={metadata.pullRequest.url}>
            {t('detail.prNumber', { number: String(metadata.pullRequest.number) })}
          </a>
          <span className={css.statusBadge} data-status={metadata.pullRequest.state === 'merged' ? 'done' : metadata.pullRequest.state === 'closed' ? 'failed' : 'running'}>
            {t(`detail.prState.${metadata.pullRequest.state}` as TaskBoardGithubKey)}
          </span>
          {metadata.pullRequest.draft && <span className={css.cardTag}>{t('detail.prDraft')}</span>}
          {metadata.pullRequest.headBranch !== undefined && (
            <span className={css.detailMeta}>
              ({metadata.pullRequest.headBranch} → {metadata.pullRequest.baseBranch ?? 'main'})
            </span>
          )}
        </div>
      )}

      {metadata.lastSyncedAt !== undefined && (
        <p className={css.detailMeta} style={{ marginTop: '6px' }}>
          {t('detail.syncedAt', { time: formatHostTimestamp(metadata.lastSyncedAt) })}
        </p>
      )}

      {metadata.lastSyncError !== undefined && metadata.lastSyncError !== '' && (
        <p className={css.formError}>{t('detail.syncError', { error: metadata.lastSyncError })}</p>
      )}
      {error !== undefined && <p className={css.formError}>{error}</p>}

      <div className={css.moveRow} style={{ marginTop: '8px' }}>
        <button type="button" className={css.ghostButton} disabled={refreshing} onClick={() => { void handleRefresh() }}>
          {refreshing ? t('detail.refreshing') : t('detail.refresh')}
        </button>
        {metadata.pullRequest === undefined && (
          <>
            <button type="button" className={css.ghostButton} disabled={refreshing} onClick={() => setShowCreatePr(true)}>
              {t('detail.createPr')}
            </button>
            <button type="button" className={css.ghostButton} disabled={refreshing} onClick={() => setShowLinkPr(true)}>
              {t('detail.linkPr')}
            </button>
          </>
        )}
      </div>

      <GitHubPromptPanel task={task} metadata={metadata} dispatch={dispatch} />

      {showCreatePr && (
        <CreatePrModal dispatch={dispatch} metadata={metadata} task={task} onClose={() => setShowCreatePr(false)} />
      )}
      {showLinkPr && (
        <LinkPrModal dispatch={dispatch} task={task} onClose={() => setShowLinkPr(false)} />
      )}
    </section>
  )
}

/** Only an http(s) issue URL becomes a link; anything else stays plain text. */
function safeIssueHref(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * The card-decoration seat: a compact issue reference on linked cards. It
 * renders as an inline chip in the card's meta row and links to the issue in a
 * new tab; the board ignores clicks that land on a link, so following the
 * issue never also opens the task detail.
 */
export function GitHubCardDecoration({ task }: { task: TaskRecord }) {
  const metadata = readTaskGitHubMetadata(task)
  if (metadata === undefined) return null
  const reference = `${metadata.owner}/${metadata.repository}#${String(metadata.issueNumber)}`
  const href = safeIssueHref(metadata.issueUrl)
  const label = `#${String(metadata.issueNumber)}`
  if (href === undefined) {
    return <span className={css.cardSchedule} data-dsh-part="github-badge" title={reference}>{label}</span>
  }
  return (
    <a
      className={`${css.cardSchedule} ${css.cardLink}`}
      data-dsh-part="github-badge"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={t('card.openIssue', { reference })}
    >
      {label}
    </a>
  )
}
