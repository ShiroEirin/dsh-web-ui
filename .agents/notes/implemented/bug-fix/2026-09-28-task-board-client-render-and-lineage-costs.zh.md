# Agent Note: 任务看板浏览器半区的渲染与谱系门禁开销

Status: implemented

## Problem

任务看板的浏览器半区上并存四个彼此独立的缺陷；其中三个是纯开销，一个让选择器永久为空。

1. **agent 预设名册被读取但从未生效。** `pushPresetOptions`（\`packages/dsh-task-board/src/client/index.ts\`）定义后从未被调用：提交 `3a64c9cf` 把结尾的 `void pushPresetOptions()` 与 `connection/reset` 订阅一并换成等价的模型目录调用时，漏掉了预设那一句。于是 `controller.setExecutionOptions({ presets })` 没有任何存活调用点，`executionOptions.presets` 在整个页面生命周期里恒为 `[]`：新建表单不渲染任何 `optgroup` 行，详情页的模式下拉只剩「继承」，继承标签永远说不出部署默认项，而每一个钉住的预设都被显示成「已移除」。这条死掉的供给对测试不可见——控制器级用例自己注入 options，没有任何用例把 `apply()` 走到能观察它们的位置。

2. **每个被渲染的时间戳都新建一个 `Intl.DateTimeFormat`。** `formatHostTimestamp` 每次调用都构造新格式化器，而看板在每次控制器通知时都会重渲染——每帧 SSE revision、15 秒的 SSE 心跳，以及搜索框的每一次击键。构造 ICU 格式化器的代价约为使用它格式化的三十倍，而定时卡片的 title 与详情页的每个时间戳都在逐次支付。

3. **链接子任务选择器对每个候选任务跑一次无索引的谱系门禁。** 候选过滤器在 `Array.prototype.filter` 里调用 `checkParentLink`，而每次调用都会重建整份账本的 `Map`（`indexOf`）、按 BFS 层级重扫（`descendantTasks`），并以 `subtreeHeight` 递归触发更多全量扫描。在 1000 条任务的账本上，单次渲染就花掉约 35 毫秒的纯谓词开销。

4. **详情浮层对控制器订阅了三次。** `TaskDetail` 由已经订阅过的 `TaskBoard` 渲染，但 `ExecutionSettingsSection` 与 `SubtaskSection` 各自又开了 `controller.subscribe(...)` 加本地 `useState`。于是每次通知都会为同一个可见浮层跑三次 `getSnapshot()` 与三次状态提交，把同一棵子树渲染两遍；`getSnapshot()` 每次都会重新分配 `pendingTaskIds`，状态标识因此永远不会触发跳过。

## Decision

1. **预设供给被重新调用。** 挂载时 `void pushPresetOptions()` 与 `void pushModelOptions()` 并列执行，`connection/reset` 处理器同时重读二者：重连后可能面对另一个部署。`tests/client-option-feeds.spec.ts` 用假上下文驱动真实的 `apply()`，其连接面返回两行名册，并断言名册抵达面板页面所拿到的控制器，因此将来若再丢掉这次调用就会失败。
2. **时间戳按时间区共享一个格式化器。** `formatHostTimestamp` 通过模块级 `Map`（以时间区 id 为键，\`''\` 代表浏览器自身）解析格式化器，每个时区只构造一次，且绝不缓存浏览器无法构建的 id——不可用的时区在本次调用中仍回退到 ISO 时刻。
3. **谱系门禁接受可复用索引。** `core/subtask.ts` 导出 `buildLineageIndex`（id 查找表 + 每个父任务的直接子节点），并且每个谱系查询（`ancestorChain`、`taskDepth`、`directSubtasks`、`descendantTasks`、`subtreeHeight`、`checkParentLink`）都接受可选的 `LineageIndex`。该参数可选，因此 Host 账本的调用点与既有测试保持无索引契约与相同判定；选择器每趟只构建一次索引，并按账本与父任务记忆化候选列表。
4. **浮层拥有其子组件的数据。** `ExecutionSettingsSection` 与 `SubtaskSection` 改为从 `TaskDetail` 的唯一订阅接收选择器选项、Agent Teams 可用性与任务列表作为 props，不再自行订阅；这两个区块的其他行为一概未变。

格式化器、索引与订阅三处改动都保留了旧代码的每一个取值：缓存格式化器返回完全相同的字符串，带索引的门禁返回完全相同的判定（`tests/lineage-index.spec.ts` 用九组查询对锁定），两个区块读取的仍是浮层所渲染的同一份快照。

## Alternatives considered

- **删掉死掉的预设供给，而不是重新调用它。** 否决：选择器、它的标签、带默认项的继承文案、「已移除预设」行，以及 Host 在每次执行时对预设的断言都真实存在并需要这份名册；该供给在更早的提交中本可达，是被意外丢失的，因此恢复它是在修复已交付契约而非新增能力。
- **把格式化器缓存放进组件或 React `useMemo`。** 否决：该格式化器以 Host 拥有的取值为键、由几十张卡片共享，并且同一个辅助函数还会被 `TaskDetail` 调用，因此以时区为键的模块级缓存才是覆盖全部调用点的最小改动。
- **为谱系门禁另开一个带索引的入口，保留原入口不动。** 否决：同一个门禁的两个导出变体会诱使无索引那个再次被放进循环调用，而那正是缺陷本身；可选参数让门禁保持唯一，判定表也保持唯一。
- **把 `LineageIndex` 改为必填并重写所有调用方。** 否决：Host 账本自身的调用点每次动作只查询一次，构建索引是纯开销，而必填参数会为无实测收益的改动搅动全部 core 测试。
- **对整个看板派生过程（`TaskBoard` 的过滤/分列一趟）做记忆化。** 本次不采纳：1000 条任务实测约 215 微秒，比选择器门禁低两个数量级且不含二次项，实测收益尚不足以抵偿额外的状态管道。该发现被记录，未被实施。
- **用共享的跨标签页 leader 中继替换这两个 EventSource 连接。** 本次不采纳：中继（`shared/client/sse-leader.ts`）通过命名的 SSE `addEventListener` 帧分发，而看板用的是默认 message 事件；设置卡片又从第二个模块绑定同一 URL；这项改动还要新增一条 sync 清单目标与设置卡片的错误路径。它确实是真实的 HTTP/1.1 连接池开销（每个标签页两条流，且同源标签页共享连接池），但它是一次自带契约的传输层改动，需要自己的证据。

## Consequences

- 模式选择器重新提供部署真实的预设名册，继承项也能说出真正的默认项。
- 看板重渲染不再按时间戳构造 ICU 格式化器，链接选择器的候选派生从二次门禁降为一次索引构建加一趟线性扫描。
- 详情浮层打开时，一次控制器通知只提交一次状态，而不是三次。
- 谱系索引是增量的 core API：`checkParentLink` 及其同级函数保持原有调用签名，Host 账本的 fail-closed 门禁未变。

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck` 与 `test`：54 个文件 / 608 通过，1 跳过（改动前基线：51 个文件 / 603 通过，1 跳过）。
- 新增用例：`tests/client-option-feeds.spec.ts`（名册经真实 `apply()` 抵达控制器）、`tests/host-timestamp.spec.ts`（每个时区一个格式化器、文案与未缓存构造完全一致、不可用时区仍可渲染）、`tests/lineage-index.spec.ts`（带索引与不带索引的判定在九组查询对上一致；1000 条任务时选择器候选趟保持线性）。
- 失败前置守卫：撤销预设调用会让 `client-option-feeds` 失败（`expected [] to deeply equal [ ...(2) ]`）；关闭格式化器缓存会让 `host-timestamp` 失败（`expected [ 'Asia/Shanghai', …(2) ] to have a length of 1 but got 3`）。
- 改动前后各测三次、取中位数，同进程同机器（darwin arm64、Node v25.8.1、vitest 4.1.11）：
  - 1000 条任务时链接选择器候选门禁：**34.7 毫秒 -> 0.3 毫秒**（115 倍；各次 40.5/34.7/34.4 对 0.5/0.3/0.2）。
  - `Asia/Shanghai` 下 500 个宿主时间戳：**10.34 毫秒 -> 0.36 毫秒**（28.6 倍；各次 17.60/10.34/9.98 对 0.42/0.36/0.32），500 个取值输出逐字节一致。
  - 1000 条任务时看板派生，作为「未对其动手」的上下文记录：中位数 215 微秒。
- 仓库门禁：`pnpm typecheck`、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm aggregate:check`、`pnpm test:scripts`（349 通过），以及重建 `dsh-web-all` 聚合 `lib/` 并重录 `scripts/lib-artifact-fingerprints.json` 之后的 `pnpm libs:check`。

## Coverage gaps

- 预设名册修复未在运行中的 GUI 里验证；名册现在抵达了选择器所读取的控制器，但渲染出的 `optgroup` 行未在浏览器中取证。
- 订阅合并仅通过未改动的渲染用例佐证；从三次状态提交降到一次是依据代码路径推得，而非插桩测得。
- 两个性能数字都是进程内测量，不是浏览器渲染耗时：它们证明被移除的开销，不证明端到端帧时间。
- 双 EventSource 连接池问题、详情页重复的 `getSnapshot()` 读取，以及搜索框对整块看板的重新派生，均已在上文记录且仍未修复。
