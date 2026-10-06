/**
 * GitHub provider settings section.
 *
 * One staged form over this extension's settings namespace, rendered INSIDE the
 * task board's own settings card: the board declares the provider-settings seat
 * and this extension is a provider of that board, so its configuration belongs
 * where the board it configures is configured, not in a peer card of its own.
 *
 * It renders the two volatile switches the extension owns (the master switch
 * and the system-prompt announcement) plus the GitHub integration block: the
 * credential, the synchronized repositories and a live connection test, all
 * served by this extension's own host routes. The integration block is live
 * only while the extension is on — a disabled extension shows what turning it
 * on would do instead of a credential form nothing can use.
 *
 * The switches are staged and written by the shared CardForm; the integration
 * block writes immediately through the setup API, because adding a repository
 * or storing a token is a discrete action whose result the user must see at
 * once (and the same writes a model performs through the setup tools).
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BooleanField, PluginSettingsCard } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { GitHubSetupPanel } from './SetupPanel.tsx'
import type { GitHubSetupApi } from './setup-api.ts'
import css from './github.module.css'

/** The extension fields this card edits (the namespace's schema). */
export interface GitHubSettings {
  /** Master switch for the extension. */
  enabled?: boolean
  /** Whether the extension announces itself in agent system prompts. */
  announceToAgent?: boolean
}

/** What the GitHub card renders. */
export interface GitHubSettingsCardState extends CardShell {
  /** The master switch as the card renders it. */
  enabled: CardFieldState
  /** The system-prompt announcement switch as the card renders it. */
  announceToAgent: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface GitHubSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGithubSettingsCard. */
    githubSettingsCard: SnapshotStore<GitHubSettingsCardState>
  }
  /** Same-origin setup API the integration block reads and writes through. */
  setup: GitHubSetupApi
}

/** Bridges the extension's settings form onto the card's staged form. */
export class GithubSettingsCardController {
  private readonly form: CardForm<GitHubSettings>
  private readonly store: SnapshotStore<GitHubSettingsCardState>

  /**
   * @param scope - the bound configuration form of the entry that owns this namespace.
   * @param setup - the same-origin setup API the integration block uses.
   */
  constructor(scope: ConfigForm<GitHubSettings>, private readonly setup: GitHubSetupApi) {
    this.form = new CardForm(scope, [booleanField('enabled'), booleanField('announceToAgent')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): GitHubSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot store and its form actions.
   */
  inject(): GitHubSettingsCardFace {
    return { hooks: { githubSettingsCard: this.store }, ...this.form.actions(), setup: this.setup }
  }

  /** Release the card's scope subscription and bound stores. */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the board's provider-settings seat. */
export type GitHubSettingsSectionProps =
  PropsRuntime<'task-board.settings.section'>
  & PropsLocale<'task-board-github'>
  & InjectFace<GitHubSettingsCardFace>

/**
 * Render the GitHub provider settings section.
 * @param props - locale copy, the section snapshot, and its form actions.
 * @returns the section, or nothing while the namespace is unavailable.
 */
export function GitHubSettingsSection(props: GitHubSettingsSectionProps) {
  const { t } = props
  const state = props.useGithubSettingsCard((snapshot: GitHubSettingsCardState) => snapshot)
  // An empty draft inherits the composition, whose default for this switch is
  // on; only an explicit "false" turns the integration off.
  const integrationEnabled = state.enabled.text !== 'false'
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      // Collapsed on arrival like the board card's own sections: the settings
      // page opens as a topic list, and the integration's form is one topic.
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-task-board-github-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        inheritLabel={t('settings.inherit')}
        overriddenLabel={t('settings.overridden')}
        resetLabel={t('settings.reset')}
        invalidLabel={t('settings.invalidValue')}
        disabled={!state.writable}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <BooleanField
        id="settings-task-board-github-announce"
        label={t('settings.announce')}
        hint={t('settings.announceHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        inheritLabel={t('settings.inherit')}
        overriddenLabel={t('settings.overridden')}
        resetLabel={t('settings.reset')}
        invalidLabel={t('settings.invalidValue')}
        disabled={!state.writable}
        {...state.announceToAgent}
        onEdit={(text) => { props.edit('announceToAgent', text) }}
        onReset={() => { props.resetField('announceToAgent') }}
      />
      {integrationEnabled
        ? <GitHubSetupPanel t={t} api={props.setup} disabled={!state.writable} />
        : <p className={css.sectionHint}>{t('settings.integrationOff')}</p>}
    </PluginSettingsCard>
  )
}
