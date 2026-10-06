/**
 * Standalone build config for the task-board GitHub provider extension.
 *
 * Uses the repository's shared client-bundle preset: node-half lib/ plus the
 * browser bundle lib/client.js (closure-factory artifact for the GUI's
 * __ModuleLoader__, CSS Modules inlined with auto-injected <style data-plugin>).
 *
 * Node-half entries point at src (tsdown compiles TS directly), so the build
 * needs no separate tsc emit for runtime artifacts.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-task-board-github', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    // Wire layers the host runtime provides: the provider registers model
    // tools and renders tool results through them.
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-llm',
  ],
})
