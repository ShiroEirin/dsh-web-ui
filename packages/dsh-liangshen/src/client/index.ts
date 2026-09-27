/**
 * dsh-liangshen browser half: the LiangShen lever in the composer tool row.
 *
 * The slot is `conversation.input.right` — "compact controls before the
 * composer submit action", which renders immediately left of the model
 * selector (`conversation.input.model`) inside the same composer card, on the
 * homepage's new-session hero as well as in a session. The lever lives only
 * while the session is still blank, because that is the only window in which a
 * preset can change at all: `agentPresets.select` refuses an already-started
 * session, and the arm would have nothing to do in one.
 *
 * This half talks to the host over the agent-preset Remote namespace rather
 * than through the official preset package's browser module: cross-plugin
 * collaboration here goes through cordis services and Remote surfaces, not
 * value imports.
 *
 * Failure policy: a missing slot or a refused Remote call is handled, never
 * thrown — one external plugin must not take the GUI boot down.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer tool row).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the settings-surface Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LiangShenLever } from './LiangShenLever.tsx'
import { LeverController } from './lever-controller.ts'
import { LiangShenSettingsCard, LiangShenSettingsCardController, type LiangShenSettings } from './LiangShenSettingsCard.tsx'
import { en, zh, type LiangShenKey } from './locales.ts'
import { installPluginCard } from './plugin-card-seat.ts'
import { createServedEntryForm } from './settings-entry-form.ts'

/** Locale namespace this half owns. */
export const NS = 'liangshen'

/**
 * Settings namespace the settings card edits: the family identity of this
 * plugin's own settings form, and the row id a standalone bundle install
 * carries. The aggregate install mounts the generated `web-ui-liangshen` row
 * instead, and the family binder resolves between the two.
 */
export const SETTINGS_NAMESPACE = 'liangshen'

/**
 * Profile entry id the family aggregate's generated row carries — the shape
 * nearly every user runs, and the id the shared-forms fallback binds when the
 * family binder cannot resolve the namespace.
 */
const AGGREGATE_ENTRY_ID = 'web-ui-liangshen'

/** Profile entry ids this package's patch rows carry, most specific first. */
const LIANGSHEN_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, 'ui-liangshen', SETTINGS_NAMESPACE]

/**
 * The profile entry id this package's own row carries, for a page that serves
 * no family binder.
 *
 * The shared describe mirror is the only local evidence of which row id this
 * profile actually serves, but it answers asynchronously: at plugin activation
 * it usually holds nothing yet. An unanswered or empty mirror is therefore NOT
 * evidence of absence, and binding the bare namespace there is what made every
 * save fail with `No configurable plugin entry "liangshen"` — the form is
 * bound once per session, so a wrong guess never recovers. The aggregate row id
 * is the answer that matches nearly every deployment; only a mirror that
 * answers with OTHER plugins' rows keeps the namespace as the last resort (the
 * pre-0.1.7 keying shape), because that answer is the one that actually proves
 * this package's own row is not served.
 * @param forms - the shared configuration forms service.
 * @returns the entry id to bind.
 */
export function servedEntryId(forms: ConfigForms): string {
  let served: readonly string[] | undefined
  try {
    served = forms.describe().getSnapshot().view?.namespaces.map(view => view.ns)
  } catch {
    // A mirror that refuses the read is unanswered too, not absent.
    served = undefined
  }
  if (served === undefined || served.length === 0) return AGGREGATE_ENTRY_ID
  return LIANGSHEN_ENTRY_IDS.find(id => served.includes(id)) ?? SETTINGS_NAMESPACE
}

/**
 * Bind the settings form the card stages over.
 *
 * The family binder comes first: it is what resolves this package's family
 * namespace onto the profile entry id the Host serves the form under, and it
 * keeps the loopback bridge as its own fallback. A page without that group (or
 * one where its client half has not applied yet) binds through the shared forms
 * service, on the entry id the describe mirror justifies and rebound as soon as
 * the mirror answers — see {@link createServedEntryForm} for why a one-shot
 * guess cannot be right for both an aggregate and a standalone install.
 * @param ctx - the browser plugin context.
 * @returns the form the settings card reads and writes.
 */
export function bindSettingsForm(ctx: ClientContext): ConfigForm<LiangShenSettings> {
  const binder = ctx.get('webUiSettings')
  if (binder !== undefined && typeof binder.bind === 'function') {
    return binder.bind<LiangShenSettings>({ namespace: SETTINGS_NAMESPACE })
  }
  return createServedEntryForm<LiangShenSettings>({
    forms: ctx.configForms,
    entryIds: LIANGSHEN_ENTRY_IDS,
  })
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers into
     * the group's list seat rather than the official bundle-configuration
     * seat. Declared here so this package needs no dependency on the sibling UI
     * package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings; absent when
     * that group plugin is not installed, so callers bind the shared forms
     * service (`ctx.configForms`) by profile entry id directly.
     */
    webUiSettings?: { bind<S>(spec: LiangShenFormSpec<S>): ConfigForm<S> }
  }
}

/**
 * One settings namespace a family card binds. The 0.1.7 client exports no spec
 * type (the form controller takes it privately), so the binder's input shape is
 * restated here.
 */
export interface LiangShenFormSpec<T> {
  /** Settings namespace registered by the owning host plugin. */
  namespace: string
  /** Narrow one wire section; undefined keeps the last accepted value. */
  decode?: (section: unknown) => T | undefined
}

/**
 * Required client services: the slot registry, locale, sessions, the shared
 * configuration forms, and the roster Remote. Both `remote` and
 * `remote.agentPresets` are declared: the context proxy refuses an uninjected
 * service, and a nested service name does not imply its parent, so reading
 * `ctx.remote.agentPresets` needs `remote` as well.
 */
export const inject = ['slots', 'locale', 'sessions', 'configForms', 'remote', 'remote.agentPresets']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The LiangShen lever copy. */
    'liangshen': LiangShenKey
  }
}

export { LiangShenLever } from './LiangShenLever.tsx'
export { LeverController, type LeverFace, type LeverSnapshot } from './lever-controller.ts'
export { LIANGSHEN_PRESET_ID, leverState, restoreTarget, type LeverFacts, type LeverState } from '../core/lever.ts'

/**
 * Mount the lever: register the copy, follow the roster and the current
 * session, and claim the composer tool row.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'liangshen: lever dictionaries')

  const controller = new LeverController(ctx)
  ctx.effect(() => () => controller.dispose(), 'liangshen: lever controller')
  try {
    controller.start()
  } catch {
    // An unavailable sessions or Remote service leaves the lever inert; the
    // view still renders and reports what it knows.
  }

  // Plugin configuration card: one staged form over the `liangshen` settings
  // namespace, contributed to the Web UI plugin group beside the
  // remote-access and task-board cards.
  try {
    const settingsCard = new LiangShenSettingsCardController(bindSettingsForm(ctx))
    // Card seat: the family group's list seat, or the official
    // bundle-configuration seat when the group is not installed.
    installPluginCard(ctx, {
      bundle: '@linxin666/dsh-liangshen',
      id: 'liangshen',
      order: 120,
      locale: NS,
      inject: () => settingsCard.inject(),
      component: LiangShenSettingsCard,
    })
    ctx.effect(() => () => { settingsCard.dispose() }, 'liangshen: settings card')
  } catch {
    // A missing settings surface leaves the lever working and the card absent;
    // one unavailable service must not take the browser half down.
  }

  ctx.slots.inject('conversation.input.right', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'conversation.input.right',
        id: 'liangshen-lever',
        order: 20,
        inject: () => controller.face(),
      }, LiangShenLever)
      return () => { unregister() }
    } catch {
      return () => {}
    }
  })
}
