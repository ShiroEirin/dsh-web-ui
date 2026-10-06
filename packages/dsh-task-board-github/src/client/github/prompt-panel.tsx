/**
 * The execution-prompt panel of the GitHub task-detail seat.
 *
 * It shows how the card's prompt was built — templated, edited by hand, or
 * frozen by an execution — and drives the optional model analysis: start one
 * (with an optional model route), regenerate a stale one, overwrite a prompt
 * somebody edited after an explicit confirmation, or drop the analysis. The
 * model call runs on the host in the background; this panel only dispatches
 * the request and then renders the progress the host writes back onto the
 * card, so a reload or a second window shows the same state.
 *
 * @module dsh-task-board-github/client/github/prompt-panel
 */
import { useState } from 'react'
import type { TaskBoardExtensionDispatch } from '../../core/contract.ts'
import { isPromptEdited, issueSourceHash } from '../../core/prompt.ts'
import type { TaskRecord } from '../../core/task-record.ts'
import { GITHUB_EXTENSION_ID, type GitHubTaskMetadata } from '../../core/types.ts'
import { formatHostTimestamp } from '../format-host-time.ts'
import { t } from '../locales.ts'
import css from '../github.module.css'

/** How a card's prompt and analysis currently stand. */
export interface PromptPanelState {
  /** The card started executing (or is archived): its prompt is frozen. */
  frozen: boolean
  /** Somebody edited the prompt after the provider last generated it. */
  edited: boolean
  /** An analysis request is in flight on the host. */
  pending: boolean
  /** Whether the stored analysis matches the current issue snapshot. */
  analysis: 'none' | 'fresh' | 'stale'
}

/**
 * Derive the panel state from a card and its provider payload.
 * @param task - the card.
 * @param metadata - its GitHub payload.
 * @returns the panel state.
 */
export function promptPanelState(task: TaskRecord, metadata: GitHubTaskMetadata): PromptPanelState {
  const analysis = metadata.analysis === undefined
    ? 'none'
    : metadata.analysis.sourceHash === issueSourceHash(metadata.remoteTitle ?? '', metadata.remoteBody ?? '')
      ? 'fresh'
      : 'stale'
  return {
    frozen: task.executions.length > 0 || task.archivedAt !== undefined,
    edited: isPromptEdited(task.prompt, metadata.promptHash, {
      ...(metadata.remoteTitle === undefined ? {} : { title: metadata.remoteTitle }),
      ...(metadata.remoteBody === undefined ? {} : { body: metadata.remoteBody }),
    }),
    pending: metadata.analysisPendingSince !== undefined,
    analysis,
  }
}

/** Report a dispatch failure the way the action channel phrased it. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The execution-prompt panel. */
export function GitHubPromptPanel({ task, metadata, dispatch }: {
  task: TaskRecord
  metadata: GitHubTaskMetadata
  dispatch: TaskBoardExtensionDispatch
}) {
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const state = promptPanelState(task, metadata)
  const analysis = metadata.analysis

  const send = async (action: string, payload: Record<string, unknown> = {}): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await dispatch({ extensionId: GITHUB_EXTENSION_ID, action, taskId: task.id, payload })
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || state.pending || state.frozen
  const generateLabel = state.edited
    ? t('prompt.overwrite')
    : state.analysis === 'none' ? t('prompt.generate') : t('prompt.regenerate')

  return (
    <div className={css.promptPanel} data-dsh-part="github-prompt">
      <p className={css.fieldLabel}>{t('prompt.title')}</p>
      <p className={css.detailMeta}>{t('prompt.templateHint')}</p>
      {state.frozen && <p className={css.detailMeta}>{t('prompt.frozen')}</p>}
      {!state.frozen && state.edited && <p className={css.detailMeta} data-prompt-state="edited">{t('prompt.edited')}</p>}

      {state.pending
        ? <p className={css.detailMeta} data-prompt-state="pending">{t('prompt.analysisPending')}</p>
        : state.analysis === 'none'
          ? <p className={css.detailMeta}>{t('prompt.analysisNone')}</p>
          : state.analysis === 'stale'
            ? <p className={css.detailMeta} data-prompt-state="stale">{t('prompt.analysisStale')}</p>
            : (
              <p className={css.detailMeta} data-prompt-state="fresh">
                {t('prompt.analysisFresh', { model: analysis?.model ?? '', time: formatHostTimestamp(analysis?.generatedAt ?? 0) })}
              </p>
            )}

      {analysis !== undefined && state.analysis === 'fresh' && (
        <div className={css.promptAnalysis} data-dsh-part="github-analysis">
          <p className={css.detailText}><strong>{t('prompt.goal')}</strong>: {analysis.goal}</p>
          {analysis.steps.length > 0 && (
            <>
              <p className={css.detailText}><strong>{t('prompt.steps')}</strong></p>
              <ol className={css.promptList}>{analysis.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
            </>
          )}
          {analysis.acceptance.length > 0 && (
            <>
              <p className={css.detailText}><strong>{t('prompt.acceptance')}</strong></p>
              <ul className={css.promptList}>{analysis.acceptance.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </>
          )}
          {analysis.notes !== undefined && (
            <p className={css.detailText}><strong>{t('prompt.notes')}</strong>: {analysis.notes}</p>
          )}
          {!analysis.needsCodeChange && (
            <div className={css.promptNotice} data-prompt-state="no-code-change">
              <p className={css.detailText}>{t('prompt.noCodeChange')}</p>
              {task.status !== 'backlog' && !state.frozen && (
                <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void send('move-backlog') }}>
                  {t('prompt.moveBacklog')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {metadata.analysisError !== undefined && !state.pending && (
        <p className={css.formError}>{t('prompt.analysisError', { error: metadata.analysisError })}</p>
      )}
      {error !== undefined && <p className={css.formError}>{error}</p>}

      {!state.frozen && (
        <>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('prompt.modelLabel')}</span>
            <input
              type="text"
              className={css.input}
              value={model}
              placeholder={t('prompt.modelPlaceholder')}
              onChange={event => setModel(event.target.value)}
              disabled={disabled}
            />
          </label>
          <div className={css.moveRow}>
            <button
              type="button"
              className={css.ghostButton}
              disabled={disabled}
              onClick={() => {
                void send('analyze', {
                  ...(model.trim() === '' ? {} : { model: model.trim() }),
                  ...(state.edited ? { overwrite: true } : {}),
                })
              }}
            >
              {state.pending ? t('prompt.analysisPending') : generateLabel}
            </button>
            {analysis !== undefined && (
              <button
                type="button"
                className={css.ghostButton}
                disabled={disabled}
                onClick={() => { void send('clear-analysis', state.edited ? { overwrite: true } : {}) }}
              >
                {t('prompt.clear')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
