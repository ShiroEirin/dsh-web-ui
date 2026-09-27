/**
 * Host loader entry for the task-board plugin.
 *
 * The Host owns the v2 ledger, action API, cron scheduler, session runner,
 * execution reconciliation, and optional idle-sleep inhibitor. The browser is
 * a same-origin asynchronous view over that service.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { TaskBoardHostService, type HostTimerFace, type TaskBoardTeamDispatcher } from './host-service.ts'
import { parseTaskDraft, TaskParseError } from './host-ai.ts'
import { TASK_PERMISSIONS, type TaskPermission } from './core/tasks.ts'
import { DEFAULT_SUBTASK_DEPTH, SUBTASK_DEPTH_MAX, SUBTASK_DEPTH_MIN } from './core/subtask.ts'
import { DEFAULT_SESSION_PERMISSION } from './core/handover.ts'
import { buildTaskBoardTools } from './host/agent-tools.ts'
import { makeTaskBoardRoutes } from './host-routes.ts'
import { mountOnce } from './mount-once.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200

/** Default environment variable holding the authenticated proxy token. */
export const DEFAULT_PROXY_TOKEN_ENV = 'DSH_TASK_BOARD_PROXY_TOKEN'

export const inject = ['systemPrompt', 'typertGateway', 'workspaceRegistry', 'webServer', 'agents', 'commands']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const TASK_BOARD_GUIDANCE = '本机已安装 dsh-task-board 插件（DSH Web GUI 的任务看板）：侧边栏「任务看板」入口；在 dsh-web 插件全家桶仓库（packages/dsh-task-board）统一维护，经聚合包 web-ui-all 一键安装。能力：多列看板管理任务；Host 权威账本；关闭浏览器后仍由 Host 执行和结算；任务可钉住工作区、agent 预设和权限；任务可建子任务（深度上限可配 1..3，默认 1 层，子任务不能再带子任务），执行父任务会并发执行其子任务树，子任务可单独覆盖权限与模型；另注册 task_board_* agent 工具（list/get/create/update/set_parent/run/manage/schedule），任何会话都可直接读写看板、子任务与定时计划，但运行任务会真实执行并消耗额度，高于会话默认权限的绑定仍必须由用户在 GUI 人工确认（工具刻意不提供确认能力）；支持 Host 本地时区的 5 段 cron，错过的触发点不补跑；可选且默认关闭的空闲系统睡眠保护允许屏幕熄灭，但不承诺拦截合盖、手动睡眠、休眠、关机或唤醒已睡眠机器。执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。若你同时用 todo_write 维护会话顶部的可见计划列表，最终回复前必须再次调用 todo_write 收尾：没有剩余工作时不要保留 in_progress，已完成的最后一步要标为 completed。'

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * This schema IS the board's settings page: the 0.1.7 Host serves one
 * configuration form per profile entry from the entry's own Config, so the
 * fields the browser card edits are marked volatile — the Loader commits
 * an edit into the running fiber's references without remounting the row (no
 * settings document of the plugin's own exists any more). A field without the
 * marker is refused by the settings write path, which fences writes on
 * volatility.
 */
export interface Config {
  /**
   * When true (default), a system-prompt section announces the board to every
   * agent. Set false to keep the board silent in prompts; agents then learn
   * about it only when the user mentions it.
   */
  announceToAgent?: Volatile<boolean>
  /** Master switch for the plugin (browser half + host announcement). */
  enabled?: Volatile<boolean>
  /** Prevent idle system sleep while sessions run or schedules are armed. */
  preventIdleSleep?: Volatile<boolean>
  /**
   * Canonical reverse-proxy Host authorities admitted with a server-side
   * token. Deployment-level, so it stays an ordinary field: editing it reloads
   * the row, which re-registers the routes with the new proxy access.
   */
  trustedProxyHosts?: string[]
  /** Environment variable whose value the authenticated proxy injects upstream. */
  proxyTokenEnv?: string
  /**
   * The deployment's session-default permission. A card whose effective
   * permission (handover bundle or pin) is above this value requires a human
   * confirmation before it may run; cron refuses unconfirmed cards.
   */
  sessionDefaultPermission?: TaskPermission
  /**
   * Subtask depth limit, 1..3 (default 1). At 1 a task may carry one level of
   * subtasks and a subtask cannot be given subtasks of its own; raising it
   * allows deeper trees. Every extra level multiplies the sessions one run
   * of the root task opens, so the ceiling is deliberately small.
   */
  maxSubtaskDepth?: Volatile<number>
  /**
   * Continuable-subagent provider the Agent Teams service uses to compose a
   * teammate. Matches the Agent Teams tool plugin's `freshProvider` default;
   * only team-mode runs use it.
   */
  teamProvider?: string
}

/**
 * Continuable-subagent provider for fresh teammates, matching the Agent Teams
 * tool plugin's own `freshProvider` default.
 */
export const DEFAULT_TEAM_PROVIDER = 'spawn'

/**
 * The schema is left to inference rather than annotated with `z<Config>`: a
 * volatile field's parsed output is a `Volatile` reference while its accepted
 * input stays the plain value, so the two sides no longer share one shape and
 * the annotation would reject the schema the Host must be given.
 */
export const Config = z.object({
  announceToAgent: z.boolean().default(false).volatile(),
  enabled: z.boolean().default(true).volatile(),
  preventIdleSleep: z.boolean().default(false).volatile(),
  trustedProxyHosts: z.array(z.string()).default([]),
  proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV),
  sessionDefaultPermission: z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION),
  maxSubtaskDepth: z.number().min(SUBTASK_DEPTH_MIN).max(SUBTASK_DEPTH_MAX).default(DEFAULT_SUBTASK_DEPTH).volatile(),
  teamProvider: z.string().min(1).default(DEFAULT_TEAM_PROVIDER),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. Spelled here because the
     * Loader package is not a dependency of this plugin, with the Loader's own
     * shape so the two declarations merge when a Host program carries both.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Read one config field's current value.
 *
 * The Loader hands schema-volatile fields as stable references it commits in
 * place, so a live value must be read at use time rather than captured when
 * the plugin activates; a plain value (a programmatic mount, or a field the
 * schema does not mark volatile) is returned as it stands.
 * @param field - the config field as the Loader handed it.
 * @param fallback - value to use when the field is absent.
 * @returns the effective field value.
 */
export function readConfigField<T>(field: Volatile<T> | T | undefined, fallback: T): T {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof (field as { get?: unknown }).get === 'function') {
    return (field as Volatile<T>).get() as T
  }
  return field as T
}

/** Resolve proxy access without ever placing the token value in plugin config. */
export function resolveProxyAccess(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): { trustedProxyHosts: string[]; proxyToken?: string } {
  const trustedProxyHosts = config?.trustedProxyHosts ?? []
  if (trustedProxyHosts.length === 0) return { trustedProxyHosts }
  const proxyTokenEnv = config?.proxyTokenEnv ?? DEFAULT_PROXY_TOKEN_ENV
  if (proxyTokenEnv.trim() === '') throw new Error('task-board: proxyTokenEnv must not be empty')
  const proxyToken = env[proxyTokenEnv]
  if (proxyToken === undefined || proxyToken === '') {
    throw new Error(`task-board: trustedProxyHosts requires a non-empty ${proxyTokenEnv} environment variable`)
  }
  return { trustedProxyHosts, proxyToken }
}

/** The registry face the agent tools register into. */
interface AgentToolRegistry {
  register(definition: ToolDefinition): () => void
}

/**
 * Resolve the optional agent-tool registry. The board deliberately does not
 * inject it: a deployment whose runtime serves no registry must still mount the
 * whole board and lose only the agent-tool surface, the same tolerance the
 * optional llm service gets.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment serves none.
 */
export function resolveToolRegistry(ctx: Context): AgentToolRegistry | undefined {
  try {
    const tools = ctx.get('tools') as AgentToolRegistry | undefined
    return tools !== undefined && typeof tools.register === 'function' ? tools : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the native cordis timer service (dsh-base's own `cordis-plugin-timer`
 * row). The board arms its schedule through it so unloading the row clears
 * every pending timer with the owning fiber, instead of the row tracking raw
 * process handles by hand. A composition that serves no timer service keeps
 * working on the process globals.
 * @param ctx - the plugin context.
 * @returns the timer face, or undefined when this deployment serves none.
 */
export function resolveHostTimers(ctx: Context): HostTimerFace | undefined {
  try {
    const timer = ctx.get('timer') as Partial<HostTimerFace> | undefined
    if (timer === undefined) return undefined
    return typeof timer.timeout === 'function' && typeof timer.interval === 'function'
      ? { timeout: timer.timeout.bind(timer), interval: timer.interval.bind(timer) }
      : undefined
  } catch {
    return undefined
  }
}

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false

/**
 * How long one teammate may take to reach its durable active or failed edge.
 * Agent Teams provisioning normally resolves in seconds; the bound exists so a
 * hung spawn settles the subtask instead of holding the cascade open forever.
 */
const TEAMMATE_PROVISION_TIMEOUT_MS = 600_000

/** The subset of the Agent Teams service this plugin drives. */
interface AgentTeamsFace {
  spawnTeammate(caller: unknown, request: {
    name: string
    description: string
    prompt: Array<{ type: 'text'; text: string }>
    context: 'fresh' | 'fork'
    provider: string
    signal: AbortSignal
  }): Promise<{ member?: { id?: string; phase?: string; error?: string } }>
}

/**
 * Resolve the optional Agent Teams service. Like the tool registry and the llm
 * runtime, it is deliberately not injected: a deployment without Agent Teams
 * must still mount the whole board and only lose team-mode runs.
 * @param ctx - the plugin context.
 * @returns the service, or undefined when this deployment serves none.
 */
export function resolveAgentTeams(ctx: Context): AgentTeamsFace | undefined {
  try {
    const teams = ctx.get('agentTeams') as AgentTeamsFace | undefined
    return teams !== undefined && typeof teams.spawnTeammate === 'function' ? teams : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the team dispatcher: the run's Lead session spawns one teammate per
 * subtask through the Agent Teams service, and the teammate's session id is
 * attached to that subtask's execution so the ordinary session monitor settles
 * it. Returns undefined when the deployment serves no Agent Teams service or
 * no live-agent registry, which makes a team run fail closed.
 * @param ctx - the plugin context.
 * @param provider - the continuable-subagent provider for fresh teammates.
 * @returns the dispatcher, or undefined when team runs cannot be served.
 */
export function buildTeamDispatcher(ctx: Context, provider: string): TaskBoardTeamDispatcher | undefined {
  const teams = resolveAgentTeams(ctx)
  if (teams === undefined) return undefined
  if (typeof (ctx.agents as { get?: unknown } | undefined)?.get !== 'function') return undefined
  return {
    async spawn(input) {
      const lead = ctx.agents.get(input.leadSessionId as Parameters<typeof ctx.agents.get>[0])
      if (lead === undefined) return { error: `lead session ${input.leadSessionId} is not live` }
      try {
        const result = await teams.spawnTeammate(lead, {
          name: input.name,
          description: input.description,
          prompt: [{ type: 'text', text: input.prompt }],
          context: 'fresh',
          provider,
          signal: AbortSignal.timeout(TEAMMATE_PROVISION_TIMEOUT_MS),
        })
        const member = result?.member
        if (member === undefined) return { error: 'Agent Teams returned no teammate' }
        if (member.phase === 'failed') return { error: member.error ?? 'teammate provisioning failed' }
        if (typeof member.id !== 'string' || member.id === '') return { error: 'Agent Teams returned no teammate session' }
        return { sessionId: member.id }
      } catch (error) {
        return { error: `teammate provisioning failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}

/**
 * Read the optional `llm` service. The board deliberately does not inject it:
 * a deployment without a model must still mount the board, and the parse route
 * answers a typed failure instead of the plugin failing to load (issue #1540).
 * @param ctx - the plugin context.
 * @returns the llm service, or undefined when this deployment serves none.
 */
export function resolveLlmRuntime(ctx: Context): LlmRuntime | undefined {
  try {
    const llm = ctx.get('llm') as LlmRuntime | undefined
    return llm !== undefined && typeof (llm as { stream?: unknown }).stream === 'function' ? llm : undefined
  } catch {
    return undefined
  }
}

/**
 * Activate the board's host half: ledger, routes, cron scheduler, power
 * inhibitor, and the model-facing announcement.
 *
 * The effective settings are the config the Host hands this row. The fields
 * the browser card edits are schema-volatile, so the Loader commits an
 * edit into the running fiber's references instead of remounting the row —
 * `sync` therefore reads them at use time and follows
 * `loader/volatile-update`, the event the Loader emits once it has committed
 * them. Every other field reloads the row, which re-runs this activation.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-task-board', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  /** Current master switch (the browser half reads the same field from its own form). */
  const enabled = (): boolean => readConfigField(config?.enabled, true)
  /** Current announcement flag. */
  const announceToAgent = (): boolean => readConfigField(config?.announceToAgent, DEFAULT_ANNOUNCE)
  /** Current idle-sleep protection flag. */
  const preventIdleSleep = (): boolean => readConfigField(config?.preventIdleSleep, false)
  /** Current subtask depth limit (read live: the settings card edits it in place). */
  const maxSubtaskDepth = (): number => readConfigField(config?.maxSubtaskDepth, DEFAULT_SUBTASK_DEPTH)

  const host = new TaskBoardHostService(ctx.typertGateway, {
    workspaceRegistry: ctx.workspaceRegistry,
    sessionDefaultPermission: config?.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION,
    maxSubtaskDepth: maxSubtaskDepth(),
    timers: resolveHostTimers(ctx),
    team: buildTeamDispatcher(ctx, config?.teamProvider ?? DEFAULT_TEAM_PROVIDER),
    commandDispatcher: {
      async execute(sessionId, line, signal) {
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) throw new Error(`execution session ${sessionId} is not available`)
        return (await ctx.commands.execute(agent, line, [], signal))?.result
      },
    },
  })
  // Configuration before start(): a disabled row must not take the first
  // scheduler tick, which would roll schedules the board is not running.
  host.setConfiguration(enabled(), preventIdleSleep())
  host.start()

  // Agent tools: the same Host ledger the browser drives, so any session can
  // list, create, link, run and settle board work. Registration follows the
  // master switch (a disabled board answers no tool call), and the mount
  // effect below owns the disposers.
  let disposeTools: (() => void) | undefined
  const setToolsEnabled = (active: boolean): void => {
    if (!active) {
      disposeTools?.()
      disposeTools = undefined
      return
    }
    if (disposeTools !== undefined) return
    const registry = resolveToolRegistry(ctx)
    if (registry === undefined) return
    const disposers = buildTaskBoardTools(host).map(tool => registry.register(tool))
    disposeTools = () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }
  setToolsEnabled(enabled())
  // A registry that activates after this row (or a row activated before it) is
  // followed through scoped injection where the runtime serves one; capture-only
  // contexts without it register through the direct resolution above.
  const scopedInject = (ctx as { inject?: (names: readonly string[], callback: (scoped: Context) => unknown) => unknown }).inject
  if (typeof scopedInject === 'function') {
    scopedInject.call(ctx, ['tools'], () => {
      setToolsEnabled(enabled())
      // Cordis unloads and re-runs this callback when the injected service's
      // provider fiber changes, and the old registry dies with its provider.
      // Releasing the guard here is what lets the callback register into the
      // NEW registry instead of short-circuiting on the stale disposer.
      return () => {
        disposeTools?.()
        disposeTools = undefined
      }
    })
  }

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      const routes = makeTaskBoardRoutes(host, resolveProxyAccess(config), {
        parseTask: async (request, signal) => {
          const llm = resolveLlmRuntime(ctx)
          if (llm === undefined) throw new TaskParseError('no-model', 'this deployment serves no llm service')
          return await parseTaskDraft(llm, request, signal)
        },
      })
      for (const route of routes) disposers.push(ctx.webServer.register(route))
    } catch (error) {
      // A failed mount must not leave the agent tools bound to a disposed
      // host: the effect cleanup never runs when this body throws.
      setToolsEnabled(false)
      for (const dispose of disposers) dispose()
      host.dispose()
      throw error
    }
    return () => {
      setToolsEnabled(false)
      for (const dispose of disposers) dispose()
      host.dispose()
    }
  }, 'task-board: host ledger, scheduler, and routes')

  let disposeSection: (() => void) | undefined
  let applied: { enabled: boolean; announceToAgent: boolean; preventIdleSleep: boolean; maxSubtaskDepth: number } | undefined

  // Apply the current values to the host service and the announcement. A
  // commit that changes nothing visible is a no-op, so following a coarse
  // invalidation cannot churn the system-prompt registry. The section is kept
  // under one disposer: re-registering first tears the old one down so a
  // duplicate-name registration never throws.
  const sync = (): void => {
    const next = { enabled: enabled(), announceToAgent: announceToAgent(), preventIdleSleep: preventIdleSleep(), maxSubtaskDepth: maxSubtaskDepth() }
    if (applied !== undefined && applied.enabled === next.enabled && applied.announceToAgent === next.announceToAgent && applied.preventIdleSleep === next.preventIdleSleep && applied.maxSubtaskDepth === next.maxSubtaskDepth) {
      return
    }
    applied = next
    host.ledger.setMaxSubtaskDepth(next.maxSubtaskDepth)
    host.setConfiguration(next.enabled, next.preventIdleSleep)
    setToolsEnabled(next.enabled)
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!next.enabled || !next.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:task-board',
      order: SECTION_ORDER,
      text: TASK_BOARD_GUIDANCE,
    })
  }

  // A settings edit of a volatile field is committed into the references this
  // fiber already holds, with no remount and no second call to apply: the
  // commit event is what makes the edit take effect without a restart.
  ctx.on('loader/volatile-update', () => { sync() })
  sync()
}
