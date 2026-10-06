/**
 * One execution's goal-acceptance report.
 *
 * Rendered inside the execution-history row, so a rerun or a scheduled run
 * keeps its OWN report and a later cycle never overwrites an earlier verdict.
 * It shows what the board decided and the evidence it decided on: the verdict,
 * the judge route and reasoning level, the acceptance count, the total and
 * per-criterion scores against their threshold, the findings the judge located,
 * the evidence scope with its truncation, and the token usage.
 *
 * Deliberately adds no new `data-dsh-part` value: the part enum is owned by the
 * cross-repository semantic-attribute contract, and this report reuses the
 * execution row's existing markup instead of extending that enum.
 */
import {
  MAX_QUALITY_ATTEMPTS,
  exceptionAttempts,
  qualityAttempts,
  verificationPhase,
  verificationTotals,
  type ExecutionVerification,
  type VerificationAttempt,
} from '../../core/verification.ts'
import { t } from '../locales.ts'
import type { TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'

/** Render one 0..1 score as a percentage. */
function percent(value: number): string {
  return (value * 100).toFixed(1) + '%'
}

/** The judge route of one attempt, with its effective reasoning level. */
function routeLabel(attempt: VerificationAttempt): string {
  const model = attempt.route.provider === '' ? attempt.route.model : attempt.route.provider + '/' + attempt.route.model
  const effort = attempt.route.reasoningEffort
  const key: TaskBoardKey = effort === undefined || effort === '' ? 'verify.judgeNoEffort' : 'verify.judge'
  return t(key, effort === undefined || effort === '' ? { model } : { model, effort })
}

/** Board phase → report badge key. */
const PHASE_STATUS_KEY: Record<ReturnType<typeof verificationPhase>, TaskBoardKey> = {
  off: 'verify.status.off',
  executing: 'verify.status.pending',
  verifying: 'verify.status.verifying',
  repairing: 'verify.status.failed',
  passed: 'verify.status.passed',
  failed: 'verify.status.failed',
}

/** One recorded attempt: a quality verdict or an acceptance anomaly. */
function AttemptRow({ attempt }: { attempt: VerificationAttempt }) {
  const exception = attempt.stage === 'exception'
  const result = exception ? 'failed' : attempt.passed ? 'succeeded' : 'failed'
  return (
    <li className={css.executionRow} data-result={result}>
      <span className={css.executionBadge} data-result={result}>
        {exception ? t('verify.status.exception') : attempt.passed ? t('verify.status.passed') : t('verify.status.failed')}
      </span>
      <span className={css.executionTimes}>
        {exception
          ? t('verify.attemptException', { index: String(attempt.index) })
          : t('verify.attempt', { index: String(attempt.index) })}
        {' · '}{routeLabel(attempt)}
        {!exception && ' · ' + t('verify.rounds', { rounds: String(attempt.rounds) })}
      </span>
      {attempt.error !== undefined && <span className={css.executionTimes}>{attempt.error}</span>}
      {!exception && (
        <>
          <span className={css.executionTimes}>
            {t('verify.summary', {
              score: percent(attempt.score),
              threshold: percent(attempt.criteria[0]?.threshold ?? 0),
              baseline: percent(attempt.baseline),
            })}
          </span>
          <span className={css.executionTimes}>{t('verify.criteria')}</span>
          <ul className={css.executionList}>
            {attempt.criteria.map(criterion => (
              <li key={criterion.id} className={css.executionTimes}>
                {t('verify.criterion', {
                  name: criterion.name,
                  score: percent(criterion.score),
                  threshold: percent(criterion.threshold),
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {attempt.findings.length > 0 && (
        <>
          <span className={css.executionTimes}>{t('verify.findings')}</span>
          <ul className={css.executionList}>
            {attempt.findings.map((finding, index) => (
              <li key={findingKey(attempt, index)} className={css.executionTimes}>{finding}</li>
            ))}
          </ul>
        </>
      )}
      {!exception && attempt.findings.length === 0 && (
        <span className={css.executionTimes}>{t('verify.noFindings')}</span>
      )}
      <span className={css.executionTimes}>
        {t('verify.evidence', {
          chars: String(attempt.evidence.chars),
          entries: String(attempt.evidence.entries),
          omitted: String(attempt.evidence.omittedCharacters),
        })}
        {attempt.evidence.workspaceFiles !== undefined && attempt.evidence.workspaceFiles > 0
          ? ' · ' + t('verify.workspaceEvidence', { files: String(attempt.evidence.workspaceFiles) })
          : ''}
      </span>
      <span className={css.executionTimes}>
        {t('verify.usage', {
          calls: String(attempt.usage.calls),
          input: String(attempt.usage.inputTokens),
          output: String(attempt.usage.outputTokens),
          reasoning: String(attempt.usage.reasoningTokens),
        })}
        {attempt.usage.usageIncomplete === true ? t('verify.usageIncomplete') : ''}
      </span>
    </li>
  )
}

/** Stable key for one finding row. */
function findingKey(attempt: VerificationAttempt, index: number): string {
  return attempt.at.toString(36) + '-' + String(index)
}

/**
 * Render one execution's acceptance report.
 * @param props - the execution's persisted acceptance block.
 * @returns the report, or nothing when acceptance never applied.
 */
export function VerificationReport({ verification }: { verification: ExecutionVerification }) {
  const phase = verificationPhase(verification)
  if (phase === 'off' && verification.contract.enabled === false && verification.applicability !== 'skipped') return null
  const totals = verificationTotals(verification)
  const route = verification.contract.route
  const applicabilityKey: TaskBoardKey | undefined = verification.applicability === 'disabled'
    ? 'verify.applicability.disabled'
    : verification.applicability === 'skipped'
      ? 'verify.applicability.skipped'
      : verification.applicability === 'goal-unavailable'
        ? 'verify.applicability.goalUnavailable'
        : verification.applicability === 'team-member' ? 'verify.applicability.teamMember' : undefined
  return (
    <div className={css.executionTimes}>
      <span className={css.executionBadge} data-result={phase === 'passed' ? 'succeeded' : phase === 'failed' ? 'failed' : undefined}>
        {t('verify.title')} · {t(PHASE_STATUS_KEY[phase])}
      </span>
      <span className={css.executionTimes}>
        {t('verify.counts', {
          quality: String(qualityAttempts(verification).length),
          max: String(MAX_QUALITY_ATTEMPTS),
          exceptions: String(exceptionAttempts(verification).length),
        })}
      </span>
      {route !== undefined && (
        <span className={css.executionTimes}>
          {verification.contract.modelSource === 'inherit'
            ? t('verify.judgeInherited', { model: route.provider + '/' + route.model })
            : t(route.reasoningEffort === undefined || route.reasoningEffort === '' ? 'verify.judgeNoEffort' : 'verify.judge', {
              model: route.provider + '/' + route.model,
              ...(route.reasoningEffort === undefined ? {} : { effort: route.reasoningEffort }),
            })}
        </span>
      )}
      {verification.contract.effortFallback !== undefined && (
        <span className={css.executionTimes}>
          {t('verify.effortFallback', {
            requested: verification.contract.effortFallback.requested,
            resolved: verification.contract.effortFallback.resolved ?? t('settings.goalVerificationResolvedNoEffort'),
          })}
        </span>
      )}
      {applicabilityKey !== undefined && <span className={css.executionTimes}>{t(applicabilityKey)}</span>}
      {verification.failedReason !== undefined && (
        <span className={css.executionTimes}>{t('verify.finalFailure', { reason: verification.failedReason })}</span>
      )}
      {totals.calls > 0 && (
        <span className={css.executionTimes}>
          {t('verify.usage', {
            calls: String(totals.calls),
            input: String(totals.inputTokens),
            output: String(totals.outputTokens),
            reasoning: String(totals.reasoningTokens),
          })}
          {totals.usageIncomplete ? t('verify.usageIncomplete') : ''}
        </span>
      )}
      {verification.attempts.length > 0 && (
        <ul className={css.executionList}>
          {[...verification.attempts].reverse().map(attempt => (
            <AttemptRow key={attempt.at.toString(36) + '-' + attempt.stage + '-' + String(attempt.index)} attempt={attempt} />
          ))}
        </ul>
      )}
    </div>
  )
}
