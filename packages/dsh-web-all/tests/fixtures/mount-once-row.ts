/**
 * Family-row stand-in for the reload contract: a host plugin guarded by the
 * shared mountOnce whose mount owns one host route - the shape every family
 * plugin (task board, market, usage, git graph...) has.
 */
import { mountOnce } from '../../../../shared/host/mount-once.ts'

interface RowContext {
  effect(effect: () => unknown, label: string): unknown
  webServer: { register(route: { kind: 'exact'; path: string; handler: () => void }): () => void }
}

export const apply = mountOnce('@linxin666/dsh-mount-once-reload-fixture', (ctx: RowContext): void => {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'exact', path: '/fixture-reload-row/state', handler: () => {} })
    return () => { dispose() }
  }, 'fixture reload row route')
})
