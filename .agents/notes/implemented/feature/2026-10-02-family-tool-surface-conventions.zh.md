# Agent Note: 家族工具面约定

Status: implemented

## Problem

本仓有五个插件包注册模型可见工具（共 24 个：八个 `task_board_*`、七个 `task_board_github_*`、六个 `ssh_*`、`git_worktree`，以及两个预设作用域的梁神工具）。各包各写各的约定，其中三个已经与官方工具包的行为脱节：

- 每个工具描述都带 `Triggers: <关键词列表>` 尾巴（21 处），把检索提示混进了工具的语义契约。官方没有任何一个工具这么做。
- 三个包各自硬编码提示词段落 order（150 / 200 / 210），没有共享定义，且公告是纯字符串。
- 因此公告不跟随工具可见性：部署不提供工具注册表、或某个作用域的工具被限制移除时，模型仍会收到一份指名了它无法调用工具的指导文案。
- 15 个工具声明 `output: { schema: { type: 'json' } }`，等于放弃 `defineTool` 本来强制执行的规范输出契约。

## Decision

`shared/host/tool-surface.ts`（由 `scripts/sync-shared.mjs` 同步进 `dsh-ssh`、`dsh-task-board`、`dsh-task-board-github`）持有这三个包共用的两条约定：

- `PLUGIN_TOOL_SECTION_ORDERS` 每个宿主插件一个 order（`ssh: 150`、`task-board: 200`），`EXTENSION_TOOL_SECTION_ORDER`（210）是外部提供方扩展的指导段落排在它所依附插件之后的专用槽位。宿主各自的段落不会再意外撞号，扩展只以自身命名、不写宿主，因此本模块在任何包内的副本都不含提供方 id（见 [Task Board external provider extension contract](../architecture/2026-09-30-task-board-extension-contract.md)）。
- `visibleToolText(tools, names, text)` 返回一个段落提供者：仅当 `names` 中至少一个能经 `tools.get(name, context.scope)` 读到才渲染 `text`。部署不提供注册表时原样渲染（缺注册表不等于能力不可用）；查询被拒也原样渲染（瞬时读失败不该静默丢掉公告）；只有查询成功但一个都读不到才渲染空串。

工具描述里的 21 处 `Triggers:` 全部移除。它们承载的触发词本就已存在于各包自己的 `*_GUIDANCE` 公告（`SSH_GUIDANCE`、`TASK_BOARD_GUIDANCE`、`GITHUB_GUIDANCE`）——那才是「指名本插件的词汇」的既定归属地，因此用户侧的能力发现没有损失，同一份文案也不再付两遍 token。

### 注册保持全局

工具继续经插件自身的 `ctx`（全局层）注册，而非逐 `agent.ctx`。这与官方 22 个工具包中的 21 个一致；只有 `dsh-experimental-tool-agent-team` 逐 agent 安装，因为它的工具属于一种必须先解析的成员资格。本家族的工具是插件能力面，没有成员资格谓词；而注册表的按作用域 `restrict()` 掩码过滤的是**继承来的全局**工具，并明确拒绝 scope-local 名字——把这些工具挪进各 agent 自己的层，反而会让它们脱离当前唯一能屏蔽它们的限制机制（梁神的工具分页正是靠 `restrict({ deny })` 把 `mcp__*` 家族挡在线外）。

### 并发与取消

`ssh_list`、`task_board_github_list`、`task_board_github_get` 声明 `isConcurrencySafe: () => true`：三者都只是内存/本地配置注册表的纯投影，并发不会交错状态，而注册表契约是 fail-closed（非精确 `true` 一律排他）。

SSH 引擎把调用方的 `exec.signal` 经 `SshEngine.exec` / `cluster` 转发进 `execCommand`。中止会关闭远端通道，并把该次调用结算为 `success: false` 加 `command cancelled by the caller`，而不是「连接掉线」；`withClient` 拒绝重试已中止的调用，因为它的重连路径可能重放非幂等远端命令（本包已记录的取舍），而一个要求停下的调用方不该看到它被重跑。

## Alternatives considered

**改成逐 `agent.ctx` 注册，与 Agent Teams 工具包对齐。** 拒绝，理由同上：那只对成员资格作用域的工具成立。对插件能力面工具，它会让工具悄悄脱离 `restrict()` 的作用范围（该 API 拒绝 scope-local 名字），这是能力回退而非改进。Agent Teams 包自己的 README 把 `restrict` 描述为过滤某个作用域*继承*的东西，注册表也把 own-layer 豁免记录为「子级的过滤器绝不该剥掉该子级赖以作答的机制」，而不是把无关能力面工具挪出过滤范围的许可。

**保留 `Triggers:` 尾巴并另加一段 policy。** 拒绝：同一份词汇付两遍。公告已经陈述了能力与指名该能力的词，工具描述应当陈述工具做什么。

**无条件渲染公告，只靠 `enabled` 开关控制。** 拒绝：开关与工具可见性是两个问题。看板可以在工具注册表缺失时仍处于启用状态（看板刻意把注册表解析为可选服务），那正是产生「指导调用不到的工具」的状态。

**给这些工具补 `presentCall` 卡片投影。** 未落地。线上 Web 客户端并不消费 `presentCall`、`presentResult` 或 `tool.call.toolview` 字段：对已安装 `app.asar` 的探测在 `dsh-client-ui-conversation/lib/client.js`、`dsh-web-app/lib/index.js`、`dsh-app-boot/lib/index.js` 中零命中。注册表自己的 README 记载内置 Web 客户端从原始参数与结果内容推导卡片属性、经 `tool.call.toolview` 选渲染器——而本部署没有任何东西读那个字段。加上这些回调属于不可观测代码；该决定留给 SDK/Web 层。

**在本次改动中把 15 个 `{ type: 'json' }` 输出 schema 换成精确 schema。** 延后，非拒绝。`defineTool` 要求 `output` 声明并按其校验成功值，因此精确 schema 是更强的契约（官方 25 个工具如此）。看板与 GitHub 工具返回深层嵌套、部分可选的投影（`taskSummary`、`taskDetail`、`githubTaskSummary`、execution 记录），其精确 schema 是比本记录其余部分大得多的改动，且需要各自的投影测试。它们暂留 `{ type: 'json' }`，保留「必须声明 output」这一契约，又不引入一个可能拒绝合法投影的 schema。

## Consequences

- 三个包共用一套「指导文案放哪、何时渲染」的定义：宿主各自持有自己的 order，扩展段落取家族扩展槽位并排在其宿主之后。
- 公告不再指名会话够不到的工具。三者 `announceToAgent` 都默认 `false`，因此只影响主动开启的用户。
- 工具描述不再携带检索关键词；同一份词汇仍在公告里。
- 被取消的 `ssh_exec` / `ssh_cluster` 调用现在会停掉远端命令，而不是把它留在远端继续跑，也不会被连接池的重连重试重放。
- 验证：`packages/dsh-ssh/tests/tool-surface.spec.ts` 与 `packages/dsh-task-board/tests/guidance-visibility.spec.ts` 覆盖共享闸门（可见、被屏蔽、无注册表、抛错注册表、空名单）；`dsh-ssh/tests/engine.test.ts` 增加「运行中中止」与「已中止信号」两例；三个包通过 `typecheck`、`test`、`build`，并由 `node scripts/sync-shared.mjs --check` 守住共享副本。
