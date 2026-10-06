# Agent Note: 任务看板空闲时停止会话名册轮询

Status: implemented

## Problem

Issue #1821：在 macOS ARM64 上，DSH 0.2.0-rc.2 配合聚合包 `dsh-web-all@0.4.5`，DeepSeek Harness host 子进程持续占用约一个 CPU 核心（Activity Monitor 103.6%，连续 `top` 采样 80.7%–119.7%），而看板上并没有执行任何任务。报告给出的链路是具体的：`TaskBoardHostService` 无条件注册 5 秒 `SESSION_POLL_MS` 定时器，`pollSessions` 只要看板处于启用状态就调用 `runner.listRunning()`，而 `listRunning` 调用 `session/list`——它会为每一条持久化会话重建一份摘要（报告人机器上约有 195 个会话目录、258 个会话锁）。`sample` 的调用栈落在 `uv__stream_io` → V8 字符串编码与 `uv_fs_stat`，正是每 5 秒重建一次完整名册的开销。同一时段本地 host HTTP 请求超时。报告人明确没有给出 A/B 对照证明，本文下面的验证也不声称有。

需求不是「少轮询一点」，而是「没有可轮询的东西时就不轮询」：空看板、没有运行中卡片、没有未结算执行、也没有已启用计划时，会话名册对它没有任何用处。

## Decision

1. **名册轮询改由账本状态而非总开关决定（#1821）。** `HostTaskLedger.runtimeView()` 现在给出 `needsSessionState`（存在待核对的执行，或运行列里有一张卡片——它的结果可能来自本进程没观测到的结算）与 `openSessionIds`（全部未结算执行的 session，包含 `openExecutions` 会跳过的延迟级联父任务）。`TaskBoardHostService.pollSessions` 只在 `needsSessionState` 成立时读取名册。运行列那一项不是凑数：由另一个进程完成的结算——同账本上的另一个 DSH 实例、agent 工具调用、人工拖动卡片——永远不会触达本服务的监听器，轮询是唯一能观测到它的路径。
   该闸门刻意不查扩展注册表。提供方能力面（`TaskBoardExtensionHost`）只暴露 tasks、integration、events、publish 与工具注册，没有任何会话能力，因此不存在「提供方有工作等这份名册」的情形；把扩展算进闸门只会让装有扩展的部署失去本修复。

2. **轮询节奏成为配置项。** `sessionPollSeconds`（schema 默认 5，范围 1..300，volatile）界定一张运行中卡片最多等多久拿到结果；`src/core/poll-cadence.ts` 是范围、默认值与「秒转毫秒」的唯一来源，Host 与设置卡片据此校验。提交新节奏时重建周期定时器，而不是等旧间隔走完。

3. **失败的轮询退避。** 固定心跳会让失败的 `session/list`——包括 `listRunning` 内部五次 `service-unavailable` 重试窗口——永远按同一节奏重试。现在每轮返回「名册是否可读」（传输抛错，或 `{ known: false }`），失败时武装翻倍延迟、上限一分钟；第一轮可读即清零。下文的复用探测共用同一套计数。

4. **会话复用为自己的启动读取名册。** `idleSessionIds`（上一轮轮询的空闲集合）已移除：空闲看板不再轮询后，缓存的名单可能已经过去数小时，既会拒绝一个一直空闲的会话，也可能往一个已经跑起来的会话里塞 Prompt。`reuseSessionFor` 在启动时为开启 `reuseSession` 的卡片读取名册，任何读取失败都新建会话——这正是「名册未知」一直以来的语义。未开启该选项的卡片完全不读名册。

## Alternatives considered

- **只调大 `SESSION_POLL_MS`，或只把它做成可配置。** 否决：报告人的开销在「每轮」而不在「每轮间隔」——间隔再长，每轮照样重建全部持久化会话行；而且诉求明确是「没有可轮询的东西时不轮询」。
- **在插件内缓存或增量维护名册。** 否决：名册的权威是 DSH 会话树，插件侧缓存要么把过期会话状态喂给执行结算，要么需要 SDK 并未暴露的失效事件。闸门只是取消读取，不重新实现名册。
- **只在看板禁用时跳过名册读取。** 否决：报告的 CPU 恰恰发生在**启用**且账本为空的看板上——禁用路径本来就是文档里的规避手段，不是修复。
- **保留 `idleSessionIds` 并接受过期。** 否决：这会让复用取决于看板上次有工作是什么时候，正是闸门要消除的行为；而过期的「空闲」判断会往另一个窗口正在使用的会话里发 Prompt。
- **把 `extensions.hasActiveExtensions()` 也算进闸门。** 否决（核对提供方契约后）：扩展 host 能力面不含任何会话能力，这一项只会削弱修复。该方法和它的测试写完即删除。
- **复用 `shared/host/poll-guard.ts`。** 否决：它的截止时间与失败上限语义适配 git-graph 的有界循环，而不是一个必须与 Host 同生命周期的循环。它在那里负责的行为（防重入与失败退避）在这里针对看板自己的定时器面实现，而该定时器由 cordis 绑定在所属 fiber 上。

## Consequences

- 空闲看板完全不读会话名册：不再逐会话构造摘要、不再逐记录 stat，其后的分配抖动也随之消失。有工作时按 `sessionPollSeconds` 轮询。
- 空闲期间电源快照的 `runningSessions` 计数停在最后一次读取值。这是刻意的：它让可选的空闲睡眠断言保持持有而不是反复抖动，而过期计数只会延后断言的释放、绝不会启动它。工作一出现，第一轮就会刷新。
- 运行中卡片的结算时延在性质上没有变化——本来就被轮询节奏限定——而节奏现在由用户决定。
- 会话树故障时按递增延迟重试，而不是每几秒重试一次；恢复后计数清零。
- 会话复用现在每次开启该选项的启动多花一次名册读取，而不是复用上一轮轮询捕获的值。未开启该选项的卡片不受影响。
- 聚合包会内联本包的客户端 bundle，而 `packages/dsh-web-all/lib` 是提交进仓库的构建产物：它在同一次改动中重建，并在 `scripts/lib-artifact-fingerprints.json` 重新记录指纹。`packages/dsh-task-board/lib` 被 git 忽略，只留在本地。

## Testing

- `packages/dsh-task-board/tests/poll-cadence.spec.ts` 固定节奏边界：默认值、上下限裁剪、取整，以及非有限输入绝不导致轮询被关闭。
- `packages/dsh-task-board/tests/host-service.spec.ts` 用网关替身端到端固定行为：空看板连续多轮读取名册 0 次；运行列里有卡片时会读取；一次运行之后的轮询恢复读取；`setConfiguration` 提交新节奏时周期定时器按新间隔重建；连续失败的轮询依次武装 10 秒、20 秒、40 秒重试，一旦某轮可读即清零，使下一次失败重新从 10 秒开始。
- `packages/dsh-task-board/tests/host-ledger.spec.ts` 固定投影本身：在既有「脱离式投影」用例上补 `openSessionIds`/`needsSessionState` 两个字段，并新增「已结算看板报 `needsSessionState: false`、把卡片拖到运行列后翻为 `true`」的用例。
- 报告人的 A/B 实测（同机上禁用与启用任务看板对比）在本仓库无法复现：它需要报告人的机器、195 个会话的 home 目录与其 DSH 构建。上述覆盖是机制层面的，issue 回帖也照此陈述。
