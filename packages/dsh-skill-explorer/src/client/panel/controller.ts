/**
 * Skill center panel controller: the single owner of the panel's view state.
 *
 * Framework-free (structural runtime faces, dsh-ssh panel/controller.ts style)
 * so the sidebar row and the React panel share one tiny subscription surface.
 * The center column belongs to the layout service: this controller asks it to
 * select the panel id instead of taking the column over at the DOM level,
 * exactly like the task board.
 *
 * The tab and editor target live here rather than in `SkillPanel` because the
 * layout mounts a keyed page only while its panel is selected: component-local
 * state would drop the open tab and any in-progress edit on every panel
 * switch. The list itself is not stored here — it refetches when its tab
 * remounts, which is the same policy the panel always had.
 */
import type { SkillEntry } from '../api.ts'

/** Stable id shared by the sidebar panel row and the main-slot page. */
export const SKILL_EXPLORER_PANEL_ID = 'skill-explorer'

/** The panel's tab identifiers. */
export type SkillTab = 'skills' | 'create' | 'edit'

/** Immutable controller snapshot for UI subscriptions. */
export interface PanelControllerSnapshot {
  /** Whether the center column shows this panel. */
  panelOpen: boolean
  /** The tab the panel is showing. */
  activeTab: SkillTab
  /** The skill being edited; the edit tab exists only while it is set. */
  editing: SkillEntry | undefined
}

/**
 * The layout's panel-navigation face. Selecting the panel is the layout's
 * business, and this is the one call that asks for it (null returns the column
 * to the conversation). Optional, so a shell-less composition keeps the pure
 * state transitions testable.
 */
export interface PanelNavigationFace {
  /** Select this panel, or null to hand the column back to the conversation. */
  select(panelId: string | null): void
}

/** Controller dependencies. */
export interface PanelControllerDeps {
  /** Layout panel selection; absent keeps the controller state-only. */
  panel?: PanelNavigationFace
}

/** The panel state owner the sidebar row and the view both read. */
export class PanelController {
  private panelOpen = false
  private activeTab: SkillTab = 'skills'
  private editing: SkillEntry | undefined
  private listeners = new Set<() => void>()
  /** Cached so getSnapshot stays referentially stable between changes. */
  private snapshot: PanelControllerSnapshot = { panelOpen: false, activeTab: 'skills', editing: undefined }

  constructor(private readonly deps: PanelControllerDeps = {}) {}

  getSnapshot(): PanelControllerSnapshot {
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Show the panel. The layout owns which panel the column renders, so the
   * state flip and the selection travel together; the selection is requested
   * after the snapshot flips, so a subscriber never observes "open" while the
   * shell still shows the conversation.
   */
  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.commit()
    this.selectPanel(SKILL_EXPLORER_PANEL_ID)
  }

  /** Return the column to the conversation, asking the layout explicitly. */
  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.commit()
    this.selectPanel(null)
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  /**
   * Reflect a selection made outside this controller (the user clicked another
   * sidebar row, or the layout dropped the panel id), keeping `panelOpen`
   * aligned with what the column actually shows.
   * @param panelId - the layout's current panel id, or null for the conversation.
   */
  syncPanelSelection(panelId: string | null): void {
    const open = panelId === SKILL_EXPLORER_PANEL_ID
    if (open === this.panelOpen) return
    this.panelOpen = open
    this.commit()
  }

  /** Switch tabs without touching the editor target. */
  setActiveTab(tab: SkillTab): void {
    if (this.activeTab === tab) return
    this.activeTab = tab
    this.commit()
  }

  /** Open the editor for one row; the edit tab appears while it is set. */
  openEditor(skill: SkillEntry): void {
    this.editing = skill
    this.activeTab = 'edit'
    this.commit()
  }

  /** Leave the editor; the list remounts and refetches the saved copy. */
  closeEditor(): void {
    this.editing = undefined
    this.activeTab = 'skills'
    this.commit()
  }

  private commit(): void {
    this.snapshot = { panelOpen: this.panelOpen, activeTab: this.activeTab, editing: this.editing }
    for (const fn of [...this.listeners]) fn()
  }

  /** Ask the layout to select a panel; a shell without the face is a no-op. */
  private selectPanel(panelId: string | null): void {
    try {
      this.deps.panel?.select(panelId)
    } catch {
      // The layout service throws by contract before its root entry mounts;
      // the state flip above already stands and the next selection retries.
    }
  }
}
