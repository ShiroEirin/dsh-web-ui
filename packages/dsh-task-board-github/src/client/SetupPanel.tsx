/**
 * The GitHub integration block of the settings card: the credential, the
 * synchronized repositories, and a live connection test.
 *
 * This panel is what makes the integration configurable without editing a
 * profile patch: a token is pasted once and stored host-side in the harness
 * credential store, repositories are added by typing `owner/repo` (a pasted
 * GitHub URL or an SSH remote work too), and the connection test reports the
 * authenticated account and each repository's reachability before anything is
 * trusted. Every write goes through the setup API, so the same edits a person
 * makes here are the ones a model makes through the setup tools.
 *
 * @module dsh-task-board-github/client/SetupPanel
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  GitHubConnectionReport,
  GitHubCredentialStatus,
  GitHubSetupSummary,
} from '../core/setup.ts'
import { addRepository, removeRepository, updateRepository } from '../core/setup.ts'
import type { GitHubRepoConfig } from '../core/types.ts'
import { GitHubSummaryBlock } from './github/sections.tsx'
import { useGitHubSummary } from './github/summary.ts'
import type { GitHubSetupApi } from './setup-api.ts'
import type { TaskBoardGithubKey } from './locales.ts'
import css from './github.module.css'

/** The panel's copy reader. */
export type SetupPanelTranslate = (key: TaskBoardGithubKey, params?: Record<string, string>) => string

export interface GitHubSetupPanelProps {
  /** Locale reader of this extension's catalog. */
  t: SetupPanelTranslate
  /** Same-origin setup API. */
  api: GitHubSetupApi
  /** Whether the surrounding card is writable; a read-only page disables every control. */
  disabled?: boolean
}

/** Render the integration block. */
export function GitHubSetupPanel({ t, api, disabled = false }: GitHubSetupPanelProps) {
  const mirror = useGitHubSummary()
  const [status, setStatus] = useState<GitHubSetupSummary | undefined>()
  const [statusError, setStatusError] = useState<string | undefined>()
  const [repositories, setRepositories] = useState<GitHubRepoConfig[]>([])
  const [repositoryError, setRepositoryError] = useState<string | undefined>()
  const [repositoryBusy, setRepositoryBusy] = useState(false)
  const [newRepository, setNewRepository] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [token, setToken] = useState('')
  const [credentialError, setCredentialError] = useState<string | undefined>()
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialSaved, setCredentialSaved] = useState(false)
  const [report, setReport] = useState<GitHubConnectionReport | undefined>()
  const [testError, setTestError] = useState<string | undefined>()
  const [testing, setTesting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.status()
      setStatus(next)
      setRepositories(next.repositories)
      setStatusError(undefined)
    } catch (error) {
      setStatus(undefined)
      setStatusError(messageOf(error))
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const write = async (next: readonly GitHubRepoConfig[], clearDraft = false): Promise<void> => {
    setRepositoryBusy(true)
    setRepositoryError(undefined)
    try {
      setRepositories(await api.writeRepositories(next))
      // Clear the draft only once the Host accepted it, so a refused write
      // leaves the user's typing in place to correct.
      if (clearDraft) {
        setNewRepository('')
        setNewLabel('')
        setNewAssignee('')
      }
    } catch (error) {
      setRepositoryError(messageOf(error))
    } finally {
      setRepositoryBusy(false)
    }
  }

  const add = (): void => {
    const edit = addRepository(repositories, newRepository, {
      ...(newLabel.trim() === '' ? {} : { inclusionLabel: newLabel.trim() }),
      ...(newAssignee.trim() === '' ? {} : { assignee: newAssignee.trim() }),
    })
    if (!edit.ok) {
      setRepositoryError(edit.message)
      return
    }
    void write(edit.repositories, true)
  }

  const toggleUnassigned = (repository: GitHubRepoConfig, include: boolean): void => {
    const edit = updateRepository(repositories, repository.owner + '/' + repository.repository, { includeUnassigned: include })
    if (!edit.ok) {
      setRepositoryError(edit.message)
      return
    }
    void write(edit.repositories)
  }

  const remove = (repository: GitHubRepoConfig): void => {
    const edit = removeRepository(repositories, repository.owner + '/' + repository.repository)
    if (!edit.ok) {
      setRepositoryError(edit.message)
      return
    }
    void write(edit.repositories)
  }

  const saveToken = async (): Promise<void> => {
    if (token.trim() === '') {
      setCredentialError(t('setup.tokenEmpty'))
      return
    }
    setCredentialBusy(true)
    setCredentialError(undefined)
    setCredentialSaved(false)
    try {
      const next = await api.setCredential(token)
      setStatus(next)
      setToken('')
      setCredentialSaved(true)
    } catch (error) {
      setCredentialError(messageOf(error))
    } finally {
      setCredentialBusy(false)
    }
  }

  const clearToken = async (): Promise<void> => {
    setCredentialBusy(true)
    setCredentialError(undefined)
    setCredentialSaved(false)
    try {
      setStatus(await api.clearCredential())
    } catch (error) {
      setCredentialError(messageOf(error))
    } finally {
      setCredentialBusy(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestError(undefined)
    try {
      setReport(await api.test())
    } catch (error) {
      setReport(undefined)
      setTestError(messageOf(error))
    } finally {
      setTesting(false)
    }
  }

  const credential: GitHubCredentialStatus = status?.credential ?? {
    configured: mirror?.hasCredential === true,
    writable: false,
    envName: 'GITHUB_TOKEN',
  }
  const controlsDisabled = disabled || credentialBusy

  return (
    <div data-dsh-part="github-settings" className={css.setupPanel}>
      <h4 className={css.settingsSummaryTitle}>{t('summary.title')}</h4>

      {statusError !== undefined && (
        <p className={css.formError}>{t('setup.apiUnavailable', { error: statusError })}</p>
      )}

      {status?.health !== undefined && (
        <div className={css.setupSection} data-dsh-part="github-sync-health">
          <p className={css.setupLine} data-dsh-stale={status.health.staleSince !== undefined ? 'true' : undefined}>
            {status.health.staleSince !== undefined && status.health.lastSyncAt !== undefined
              ? t('setup.healthStale', { minutes: String(Math.floor((Date.now() - status.health.lastSyncAt) / 60000)) })
              : status.health.lastSyncAt !== undefined
                ? t('setup.healthOk', { at: new Date(status.health.lastSyncAt).toLocaleTimeString() })
                : t('setup.healthNever')}
          </p>
          {status.health.lastErrors.length > 0 && (
            <p className={css.formError}>{t('setup.healthErrors', { count: String(status.health.lastErrors.length) })}</p>
          )}
        </div>
      )}

      <div className={css.setupSection} data-dsh-part="github-credential">
        <p className={css.setupLine}>
          {credential.configured
            ? t('setup.credentialConfigured', { name: credential.envName, source: credential.source ?? t('setup.credentialSourceUnknown') })
            : t('setup.credentialMissing', { name: credential.envName })}
        </p>
        {credential.reason !== undefined && <p className={css.setupHint}>{credential.reason}</p>}
        <div className={css.setupRow}>
          <input
            type="password"
            className={css.input}
            data-dsh-part="github-token"
            aria-label={t('setup.tokenLabel')}
            placeholder={t('setup.tokenPlaceholder')}
            value={token}
            autoComplete="off"
            spellCheck={false}
            disabled={controlsDisabled}
            onChange={event => setToken(event.target.value)}
          />
          <button
            type="button"
            className={css.primaryButton}
            data-dsh-part="github-token-save"
            disabled={controlsDisabled || token.trim() === ''}
            onClick={() => { void saveToken() }}
          >
            {credentialBusy ? t('setup.tokenSaving') : t('setup.tokenSave')}
          </button>
          {credential.configured && (
            <button type="button" className={css.ghostButton} disabled={controlsDisabled} onClick={() => { void clearToken() }}>
              {t('setup.tokenClear')}
            </button>
          )}
          <button type="button" className={css.ghostButton} disabled={disabled || testing} onClick={() => { void runTest() }}>
            {testing ? t('setup.testing') : t('setup.test')}
          </button>
        </div>
        <p className={css.setupHint}>{t('setup.tokenHint')}</p>
        {credentialError !== undefined && <p className={css.formError}>{credentialError}</p>}
        {credentialSaved && <p className={css.setupHint}>{t('setup.tokenSaved')}</p>}
        {testError !== undefined && <p className={css.formError}>{t('setup.testFailed', { error: testError })}</p>}
        {report !== undefined && (
          <div className={css.setupReport} data-dsh-part="github-test-report">
            <p className={css.setupLine}>
              {report.login === undefined
                ? t('setup.testNoCredential')
                : t('setup.testLogin', { login: report.login })}
            </p>
            {report.checks.map(check => (
              <p
                key={check.owner + '/' + check.repository}
                className={check.ok ? css.setupHint : css.formError}
                data-dsh-part="github-test-check"
              >
                {check.owner}/{check.repository} · {check.message}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className={css.setupSection} data-dsh-part="github-repositories">
        <p className={css.setupLine}>
          {repositories.length === 0
            ? t('setup.repositoriesEmpty')
            : t('setup.repositoriesCount', { count: String(repositories.length) })}
        </p>
        {repositories.map(repository => (
          <div key={repository.owner + '/' + repository.repository} className={css.setupRow} data-dsh-part="github-repository">
            <span className={css.setupRepository}>
              {repository.owner}/{repository.repository}
              <span className={css.cardTag}>{repository.inclusionLabel ?? 'dsh'}</span>
              {repository.assignee !== undefined && repository.assignee !== '' && (
                <span className={css.cardTag} data-dsh-part="github-repository-assignee">
                  {t('setup.assigneeChip', { login: repository.assignee })}
                </span>
              )}
              {repository.includeUnassigned === true && (
                <span className={css.cardTag} data-dsh-part="github-repository-unassigned">
                  {t('setup.unassignedChip')}
                </span>
              )}
            </span>
            <button
              type="button"
              className={css.ghostButton}
              data-dsh-part="github-repository-unassigned-toggle"
              aria-pressed={repository.includeUnassigned === true}
              disabled={disabled || repositoryBusy}
              onClick={() => { toggleUnassigned(repository, repository.includeUnassigned !== true) }}
            >
              {repository.includeUnassigned === true ? t('setup.unassignedOn') : t('setup.unassignedOff')}
            </button>
            <button
              type="button"
              className={css.ghostButton}
              data-dsh-part="github-repository-remove"
              disabled={disabled || repositoryBusy}
              onClick={() => { remove(repository) }}
            >
              {t('setup.repositoryRemove')}
            </button>
          </div>
        ))}
        <div className={css.setupRow}>
          <input
            type="text"
            className={css.input}
            data-dsh-part="github-repository-input"
            aria-label={t('setup.repositoryLabel')}
            placeholder={t('setup.repositoryPlaceholder')}
            value={newRepository}
            spellCheck={false}
            disabled={disabled || repositoryBusy}
            onChange={event => setNewRepository(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') add() }}
          />
          <input
            type="text"
            className={css.input + ' ' + css.setupLabelInput}
            data-dsh-part="github-repository-label-input"
            aria-label={t('setup.inclusionLabel')}
            placeholder={t('setup.inclusionLabelPlaceholder')}
            value={newLabel}
            spellCheck={false}
            disabled={disabled || repositoryBusy}
            onChange={event => setNewLabel(event.target.value)}
          />
          <input
            type="text"
            className={css.input + ' ' + css.setupLabelInput}
            data-dsh-part="github-repository-assignee-input"
            aria-label={t('setup.assignee')}
            placeholder={t('setup.assigneePlaceholder')}
            value={newAssignee}
            spellCheck={false}
            disabled={disabled || repositoryBusy}
            onChange={event => setNewAssignee(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') add() }}
          />
          <button
            type="button"
            className={css.primaryButton}
            data-dsh-part="github-repository-add"
            disabled={disabled || repositoryBusy || newRepository.trim() === ''}
            onClick={add}
          >
            {t('setup.repositoryAdd')}
          </button>
        </div>
        <p className={css.setupHint}>{t('setup.repositoriesHint')}</p>
        {repositoryError !== undefined && <p className={css.formError}>{repositoryError}</p>}
      </div>

      {statusError !== undefined && mirror !== undefined && (
        <div className={css.setupSection}>
          <GitHubSummaryBlock summary={mirror} />
        </div>
      )}
    </div>
  )
}

/** Read one failure the way the API phrased it. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
