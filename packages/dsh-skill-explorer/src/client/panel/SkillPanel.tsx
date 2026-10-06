/**
 * The skill center panel shell: a title header, a tab bar, and the active
 * tab's content.
 *
 * The tab and the editor target live in the controller, not in component
 * state: the layout mounts this page only while the panel is selected, so
 * local state would drop the open tab and any in-progress edit on every panel
 * switch. The inactive tab unmounts, so the tab that needs the workspace
 * resolves it itself and the list refetches when it returns.
 *
 * The edit tab appears only while a skill is being edited: the list row hands
 * the chosen skill over, and leaving the editor returns to the list.
 */
import { useSyncExternalStore } from 'react'
import { SkillApi } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import type { PanelController, SkillTab } from './controller.ts'
import { CreateTab } from './CreateTab.tsx'
import { EditTab } from './EditTab.tsx'
import { SkillsTab } from './SkillsTab.tsx'
import css from './panel.module.css'

/** Panel shell props. */
export interface SkillPanelProps {
  /** The panel state owner (open/close/toggle, active tab, editor target). */
  controller: PanelController
  /** The skill center API client every tab operates through. */
  api: SkillApi
}

/** The skill center panel. */
export function SkillPanel({ controller, api }: SkillPanelProps) {
  const { activeTab, editing } = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
  )

  const tabs: ReadonlyArray<{ id: SkillTab; label: () => string }> = [
    { id: 'skills', label: () => tt('tab.list') },
    { id: 'create', label: () => tt('tab.create') },
    ...(editing === undefined ? [] : [{ id: 'edit' as SkillTab, label: () => tt('tab.edit') }]),
  ]

  return (
    <div className={css.panel} data-dsh-plugin="skill-explorer">
      {/* No back control: the sidebar row toggles this panel, and opening any
          session (or new chat) returns the center column to the conversation,
          exactly like the shell's own Plugins and Schedule pages. */}
      <div className={css.panelHeader}>
        <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
      </div>
      <div className={css.tabBar} role="tablist" data-dsh-part="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-active={activeTab === tab.id ? '' : undefined}
            data-dsh-part="tab"
            className={css.tab}
            onClick={() => { controller.setActiveTab(tab.id) }}
          >
            {tab.label()}
          </button>
        ))}
      </div>
      <div className={css.panelContent}>
        {activeTab === 'skills' && <SkillsTab api={api} onEdit={skill => { controller.openEditor(skill) }} />}
        {activeTab === 'create' && <CreateTab api={api} />}
        {activeTab === 'edit' && editing !== undefined && (
          <EditTab
            api={api}
            skill={editing}
            onDone={() => { controller.closeEditor() }}
            onCancel={() => { controller.closeEditor() }}
          />
        )}
      </div>
    </div>
  )
}
