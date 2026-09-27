# Agent Note: Issue 批次 1707-1708 —— 前端路由改为文档相对路径、复用执行如实标记失败

Status: implemented

## Problem

两条报告，均在动手前于本检出复现。

**#1707 —— 客户端路由逃出了子路径部署。** Harness 为 Web GUI 只注入一个文档 base：`<base href="./">`（`packages/host/frontend-static/src/index.ts` 的 `renderIndex`），因此同一份 index 既服务源站根目录，也服务反向代理挂载的任意前缀。官方客户端遵守这一点：`packages/client/connection/src/client/rpc.ts` 提交 `${channel}/${endpoint}`.slice(1) —— 不带前导斜杠的文档相对路由。本仓插件却写根绝对字面量（`/api/dsh-skill-explorer/list`、`/git/status`、`/api/pair/status`、`/api/update/status`、`/api/task-board/state`、`/api/market/install-*`、`/api/dsh-usage/*`、`/api/dsh-session-archive/*`、`/api/plugin-manager/*`、`/api/dsh-web-all/rows`，以及两处 `EventSource` URL）。根绝对路径按源站解析而非按挂载点解析，于是在 `/dsh/dsh` 下这些请求全部错过宿主路由——报告者的 `/api/dsh-skill-explorer/list` 从未到达插件。

**#1708 —— 失败的复用执行被记为 `succeeded`，且复用分支漏掉 preset 断言。** `HostExecutionRunner.inspect` 依据执行窗口内最新的 `turn/end` 判定结果，而 `isErrorTurnEnd` 仅在 `reason.kind === 'error'` 时返回真。harness 可能追加的其余原因——`aborted`、`blocked`、`max-tokens`、`interrupted`、`forked`——一律落入 `{ outcome: 'succeeded' }`。`interrupted` 正是重启的产物：`packages/core/session/src/repair.ts` 的 `interruptedTurnClosers` 为「末尾 turn 未结束」的持久化日志合成该原因。因此一次在 resume 阶段夭折的 cron 执行被标记成功，定时任务静默失效——这正是报告者遇到的可见性问题。同一判据还会把无法解析的载荷当作成功。此外复用分支只重新断言了钉住的 permission 与 model（`pinAndPrompt`）；新建分支会向 `session/create` 传 `agentPreset: mode`，于是由不同 preset 组成的会话被复用时会带着错误组合继续运行且没有任何诊断。

测试夹具掩盖了该判定缺陷：五处 `turn/end` 夹具使用 `reason.kind: 'complete'`，而该值在 harness 中从未存在（`packages/core/session/src/types.ts` 的联合类型声明的是 `completed`）。宽松的判据让这些夹具得以通过。

## Decision

**客户端路由采用文档相对形式，共享常量改为派生而非重复。** 各插件浏览器半区提交的同源路由一律去掉前导斜杠，与官方客户端一致。`dsh-task-board` 保留宿主用于注册路由的根绝对 `TASK_BOARD_API_PREFIX`，并在 `src/client/host-api.ts` 派生 `CLIENT_API_PREFIX = TASK_BOARD_API_PREFIX.slice(1)`，两侧因此无法漂移。`dsh-skill-explorer` 的 `contract.spec.ts` 漂移门禁在把相对字面量还原为根绝对路径后再与宿主 `ROUTES` 表比对，并额外断言不会重新引入 `'/api/` 根绝对字面量。在源站根目录下相对路径与绝对路径解析出同一 pathname，故此处行为不变；带前缀时二者是「到达路由」与「错过路由」的区别。

**执行只有在取得「turn 已完成」的正面证据时才算成功。** `nonCompletedTurnEnd` 对任何非 `completed` 返回其原因 kind，对无法解析的载荷返回 `unknown`；`inspect` 对两者都报告 `failed`，并保留 `error` 原因原有的 `agent turn ended with an error` 文案。五处错误夹具已更正为 `completed`。

**复用分支通过「读取」而非「新建」来断言钉住的 preset。** 新建分支经由 `session/create` 的 `agentPreset` 断言钉住值。复用分支不得调用该方法——那会创建或重新收养本应只是被继续的会话，这既违反本包自己的规则（「复用时重新应用钉住的 permission/model 再入队 Prompt，不重命名、不新建」），也被 `tests/host-runner.spec.ts` 断言（`reuse must not call session/...`）。因此 `assertReusedPreset` 通过 `session/projections` 读取记录值——该文档化读取不解析任何 Agent——并在不匹配或无法读取时 fail closed。`projections` 的请求走 `request` wire 键，且已登记进测试 fake 的 `wireArgsKeys` 表，漂移的封装无法蒙混通过。

## Testing

`packages/dsh-task-board/tests/host-runner.spec.ts` 新增四个测试：会话记录另一 preset 时复用执行 fail closed 并同时点名两个 preset 且从不投递 prompt；记录值无法读取时拒绝复用；`interrupted` turn 报告 `failed`；畸形 `turn/end` 报告 `failed`。四者在修复前源码上全部失败（通过 stash `src/host-runner.ts` 验证）。客户端路由改动由断言所提交 URL 的各包测试覆盖：`dsh-skill-explorer/tests/client-api.spec.ts` 与 `contract.spec.ts`、`dsh-git-graph/tests/create-worktree-session.spec.ts`、`dsh-task-board/tests/host-api.spec.ts`、`dsh-remote-web-ui/tests/{pair-api,deep-link,remote-entry,update-entry}.spec.*`。

## Alternatives considered

**引入共享的「按 `document.baseURI` 解析」相对 URL 辅助函数。** 否决其作为主要机制。辅助函数确实能集中规则，但浏览器对 `fetch`、`EventSource`、`WebSocket` 本就会把相对路径按 `document.baseURI` 解析，辅助函数的唯一职责就是复刻平台行为。字面量形式还与官方客户端逐字一致，这正是该约定可被「读上游源码」审计的原因。

**改在远程通道的围栏内部重写路径。** 通道的 `shouldRewriteFetchPath` 以 `pathname.startsWith('/api/')` 匹配，带前缀时解析出的 pathname（`/dsh/dsh/api/...`）不再匹配，于是带前缀的**远程**页面会不再走门控通道。这是一个真实的后继缺口，但它不是报告者的部署形态：报告者的页面是本地反代挂载，此时通道根本未安装（`remoteChannelRequired` 对 loopback 页面返回 false），相对路由直接抵达代理。让围栏感知挂载前缀，意味着把挂载前缀贯穿浏览器补丁与解析期 boot 脚本，改动一个安全敏感的闸门——超出本批次范围，留给专门改动。

**只报告 `interrupted`，其余保持旧的宽松默认。** 否决。报告者看到的失败在任务板层面与其他任何「未完成」原因无法区分，而「无法解析的载荷」恰恰是最不该沉默的情形。要求 `completed` 让成功路径变窄、失败路径变响。

**在复用路径上调用 `session/create` 以顺带获得 preset 断言。** 否决：它违反本包「复用不新建会话」的规则，且已有测试对此断言。

**向 `session/projections` 传 `agentPreset`。** 不适用：`projections` 是无此参数的读取，这正是比较发生在任务板侧的原因。

## Consequences

带前缀挂载的 GUI 现在能到达每个插件路由。在源站根目录下无可观察变化。

在完成前夭折的 cron 或手动执行会以带原因信息的 `failed` 记录，而不是 `succeeded`。既有账本保留其历史记录；只有新被巡检的执行按此分类。会话由与卡片钉住值不同的 preset 组成时，复用路径现在 fail closed——此前在错误组合下静默运行的卡片会开始报告启动失败，直到修正会话或钉住值，这正是预期的取舍。

远程配对围栏仍不感知前缀（见 Alternatives）。由**远程**设备访问的子路径部署不在本次改动范围内。

宿主半区无需重启 DSH 服务；客户端半区随插件 bundle 发布，bundle 重建后刷新页面即生效。