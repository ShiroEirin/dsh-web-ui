# Agent Note: Task-board goal acceptance

Status: implemented

## Problem

任务看板的执行跑的是一个自主 goal：runner 武装 `/goal`，goal 轮次驱动不断开启续跑回合，卡片在目标离开 active 阶段时结算。这个闭环里没有任何环节为「工作」背书——判断目标已达成的唯一一方就是 agent 自己，而看板的结算读的正是这份自述：一个把成功讲了一遍并调用 `update_goal(action: complete)` 的会话，会把卡片结算成已完成。

要求的控制是一个由评测者背书的门禁，并且额度很小、语义明确：`update_goal(action: complete)` 生效前必须对本次运行的真实证据做出判定；第一次不通过把问题反馈给修复方，第二次不通过结束这次 execution。判定规则取已安装 `dsh-llm-verifier`（0.8.4，MIT）的默认最终验收，且配置必须按 execution 冻结，使之后的设置改动无法改变已在运行中的判据。

## Decision

看板端到端拥有验收机制，并且复用 verifier 的默认验收「算法」，而不是 verifier 本身。

- **门禁。** 监听器挂在官方「工具执行前」生命周期（`ctx.on('tools/pre-execute')`），只处理 `action: 'complete'` 的 `update_goal`。调用所在的会话经 `HostExecutionLedger.findOpenExecutionBySession` 解析为看板的未结算 execution；该 execution 已有通过记录才放行，否则返回反馈，调用根本到不了 goal 服务。看板从不要求 agent 自证，任何提示词措辞也绕不过这道门。
- **算法。** `src/core/verification.ts` 在与裁判提示词相关处逐字对齐 verifier 的默认最终验收：`DEFAULT_CRITERIA` 的三项 coding 判据（Specification Adherence、Output Match、Error Signal Detection）、20 级 A–T 量表及其 `<score_A>`/`<score_B>` 标签契约、不可信证据边界、候选 B 为 `EMPTY_WORK_BASELINE`、每项两轮且奇数轮交换 A/B、单轮分数映射回调用方槽位后按判据取平均，以及通过规则 `score > baseline && score >= 0.65 && 每项 >= 0.65`（`sessionAccepted`）。评分走 explicit-tag 通道，因为官方 DSH adapter 不暴露 token logprobs：verifier 偏好的 logprob 通道需要公开 SDK 不具备的能力，故本部署支持的通道就是标签回退，并如实记录所用通道。
- **派发。** 每一次单次裁判请求都经 `src/host/llm-dispatch.ts`，以 `prepareCall(config).stream(request)`——官方 agent loop 自己使用的、绑定注册代的入口——开启流，仅在运行时根本不提供 `prepareCall` 时回退到公开的 `llm.stream(options)`。公开方法只是一个普通可变实例属性：第三方 provider 插件把它替换成自己的 `llm/stream` 监听器签名 `(options, next)` 后，每一次验收都抛出 `TypeError: next(...) is not a function or its return value is not async iterable`，被 runner 在两次重试后记为「裁判请求失败」异常。在 `llm/stream` 上注册的插件经这条 prepared 派发路径仍会被调用；看板只是不再依赖一个插件可以合法替换的属性。
- **证据。** 裁判看到的是本次 execution 的组合目标，以及该会话自身事件日志中从 `startedAt` 起的窗口——带参数的工具调用、工具结果（含错误标记）、assistant 文本、goal 轮次标记与团队消息——并按 verifier 的脱敏规则处理，逐条与总量封顶、保留最新文本并报告截断。不把看板自身的记账当作工作证明；复用会话只贡献本次 execution 启动之后的事件。若部署会记录工作区变更，则宿主自身对本次运行「改了磁盘上什么」的记录（文件清单与增删行数、逐文件的有界对比）会作为提示词的参考上下文块渲染，并计入其分隔 token，因此只在自述里描述过的补丁、或事后被再次编辑的文件，无法冒充已应用的改动；不提供该服务的部署、或读取失败，都退化为只判轨迹，而不是让验收失败。
- **裁判恢复。** 终止事件按 SDK 的 `FinishReason.kind` 对象读取，保留结构化错误与取消原因；失败或截断的流即使带有评分标签也不能形成质量判定。每项裁判请求最多尝试三次；初次请求和重试的输出预算固定为 16384 token，不改变冻结的推理等级；空回答、截断或评分标签无效时均在相同预算内重试。鉴权失败和取消立即停止，暂时性请求错误有界重试。用量累计每次已计费请求，并传递不完整计量标记。这允许推理模型在初始预算被思考耗尽后恢复输出，不降低评分标准，也不重置 execution 额度。
- **额度。** 每个 EXECUTION 两次质量验收 + 两次异常，记录在 execution 记录上（`ExecutionRecord.verification`，账本 schema v5）。键是 execution 而不是 goal id：agent 无法新建 goal 重置额度；重复完成调用、跨入下一 goal 轮次、插件重载与宿主重启都复用同一周期。重跑或一次定时触发是新的 execution，各自计数。
- **异常。** 超时、鉴权失败、裁判回答无法解析、裁判路由不可解析都记为 `exception` 尝试，与质量判定分开，不消耗质量额度，有界收敛，且绝不静默通过。
- **冻结。** `HostExecutionRunner.launch` 汇报 `/goal` 是否武装成功，服务在 Prompt 入队之前冻结契约：由实时设置对照宿主模型目录默认路由解析出的裁判路由（`session/modelCatalog`；「继承宿主」绝不等于卡片钉住的执行模型）、本次运行的适用性（`enforced`/`goal-unavailable`/`disabled`/`team-member`）与阈值。显式配置的推理强度只有目标模型 adapter 声明支持时才传参，否则丢弃该不兼容值、改用该模型自身默认档位，并记录与展示回退。
- **结算。** 适用性为 `enforced` 时，结算为 `succeeded` 必须有匹配的通过记录。于是旧回退路径再也无法让 goal 执行通过：完成的回合、暂停的 goal、读取失败的 projection、人工强制结算，在没有通过记录时一律判失败；门禁已收口的周期直接按其记录原因结算，不必再等一次巡检；从未成为 goal 执行的运行与 teammate 成员则明确「不受门禁」，而不是被暗示已验收。
- **团队执行。** 验收作用于 Lead 的 execution，其会话证据就是团队汇总；teammate 的 execution 记为 `team-member`，不单独验收。
- **界面。** 设置卡新增任务验收分区（默认开启的开关、裁判模型、推理强度与解析后的配置），运行列显示「执行中 / 验收中 / 验收未通过修复中」，每条 execution 记录携带绑定该 execution 的报告。`GET /api/task-board/verification` 在看板既有 loopback / 认证代理门禁后提供解析后的选项与宿主模型目录。

## Alternatives considered

- **导入 `dsh-llm-verifier/core` 并调用其公开原语。** 该插件的 exports 提供 `VerifierEngine`、`DEFAULT_CRITERIA`、`EMPTY_WORK_BASELINE` 与 `sessionAccepted`，但不提供会话级验收（它是 `apply` 内部的闭包），也不导出证据提取器，宿主侧仍要自己写门禁、证据与额度。放弃理由：本仓包规则要求 host 半区只依赖官方 `@deepseek-ai/*` SDK；该插件不是本仓依赖；安装单元路径按 profile 而异。因此选择镜像算法，并在 Note 中记录依据（0.8.4、MIT、常量一致），而不是建立运行时耦合。
- **把门禁挂在 `agent/turn-stopping`。** 那正是第三方 verifier 所在的位置，但它只能看到已经发生的回合并事后提示，无法在 goal 服务提交前拒绝 `update_goal`。需求要的是完成调用的门禁，所以工具生命周期是唯一正确的接缝。
- **只用提示词反馈、不拒绝调用。** 放弃：那样 agent 仍能把目标标记完成，而需求是「没有通过记录，完成声明就不能生效」。
- **只靠 blocking goal 收口。** `ctx.goals.block` 作为尽力而为的手段用来阻止已耗尽周期继续烧轮次，但它不是权威：不提供 goal 服务的部署（或 block 被拒）会让执行永久 pending。真正结束执行的是记录下来的 `failedReason` 与消费它的结算守卫。
- **按 goal id 记账额度。** 新建 goal 就能拿到新额度，正是需求点名的绕过路径。
- **直接问裁判「是否完成」。** 需求否决：判定使用 A–T 量表与逐项阈值规则，而不是是非问答。
- **自动 rubric 选择。** 延后：第一版只用 coding 判据，设置文案也说明该分区面向工程任务。
- **为报告新增 `data-dsh-part` 枚举值。** 该枚举由跨仓语义属性契约拥有，因此报告复用 execution 行既有标记，不扩展该枚举。

## Consequences

- 强制验收既是质量决定也是成本决定：一次验收是 3 项判据 × 2 轮（6 次裁判请求），而一个 execution 最多验收两次，因此需要修复一次的 goal 周期最多多花 12 次请求。开关默认开启，设置文案与 README 均明确说明。
- 不提供模型目录的部署无法解析裁判路由：开启验收时完成声明会被拒绝并记为异常，而不是静默通过。这是 fail closed 的选择，异常有界因而不会活锁。
- 已安装的第三方 verifier 仍会跑它自己的自动验收（`autoVerifyMode` 默认 `smart`）。两个裁判会各自对同一会话评分：本看板的验收决定能否完成，另一个只做提示，公开 SDK 接口无法共享同一判定。可靠避免付两次费只能关闭对方的自动模式；README 将其记为已知限制，而不是假装二者天然互斥。
- 账本 schema 升至 v5。迁移是增量的，且刻意不给已在执行的 execution 补写契约，因此没有在跑的运行被追溯评判。无法解析的验收块会被丢弃（fail closed），import 路径会剥离该块，使伪造的通过记录无法让导入的工作看起来已验收。
- 验收不是会话级属性：它属于某一次 execution，因此历史、重跑与定时出现各带自己的报告；也正是按 execution 冻结契约，才使运行中途的设置改动对该次运行毫无影响。
- 门禁刻意不碰普通聊天、钉住 `goalRun: false` 的任务，以及 `/goal` 被拒的运行：它们不是 goal 执行，记录会写明属于哪种情况。

## Testing

- `tests/goal-verification-gate.spec.ts`（27 个场景）：首次验收通过、失败后修复通过、第二次失败收口并冻结额度、并发完成共享一次验收、重跑获得新额度、额度跨宿主重启保留、无法解析回答与裁判路由抛错分别记异常且各自有界、goal 不可用与 teammate 成员不受门禁、实时设置变更后仍由冻结契约判定、两轮交换与取平均、会话复用证据隔离、强度回退、路由不可解析、调用已取消、已结算 execution，损坏的存储块、宿主工作区变更证据进入裁判、该证据在对比读取失败时降级、部署不记录变更时的纯轨迹提示词，仅在存在宿主证据时才出现参考上下文块，第三方插件把公开 `llm.stream` 替换成其 waterfall 监听器签名后验收仍能得出判定，以及运行时没有 `prepareCall` 时保留公开方法回退。
- `tests/goal-verification-service.spec.ts`（17 个场景）：契约在 Prompt 之前冻结并绑定、开关关闭、`goalRun: false`、`/goal` 被拒、显式路由配不支持档位、定时运行、解析后的选项路由，以及结算规则（goal 完成但无通过记录判失败、暂停 goal 判失败、projection 读取失败判失败、通过记录结算为完成、已收口周期无需再巡检即结算、单回合任务按历史判定、v5 之前的 execution 不被追溯、开关只影响之后的执行、会话复用携带新 execution 自己的契约）。
