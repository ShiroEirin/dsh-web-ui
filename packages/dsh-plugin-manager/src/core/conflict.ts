/**
 * The install-conflict ledger row. The official host applies structural
 * conflict rules at install time (disableControlsOnInstall: installing the
 * dsh-web family disables the built-in web-ui product rows so the two never
 * double-mount) and the gateway host records what the official CLI moved
 * around an install, so a failure can be attributed to a concrete row rather
 * than to an unknown install side effect.
 *
 * This is host-side bookkeeping. The panel that rendered these rows as
 * reversible conflict notices lived in the removed "Plugin manager" tab, so
 * only the row shape remains here.
 * @module @linxin666/dsh-client-ui-plugin-manager/core
 */

import type { LayerState } from './patch-diff.ts'

/** One observed row membership change between two layer snapshots. */
export interface ControlChange {
  id: string
  name: string
  from: LayerState
  to: LayerState
}
