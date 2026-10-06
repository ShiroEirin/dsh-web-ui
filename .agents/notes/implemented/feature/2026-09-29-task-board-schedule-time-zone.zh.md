# Agent Note: 任务看板定时规则携带显式 IANA 时区

Status: implemented

## Problem

任务看板的定时规则原本只是一个 5 段 cron 表达式，按 Host 进程碰巧报告的时区求值。`ScheduleRule` 为 `{enabled, cron, nextRunAt, lastTriggeredAt}`，不含时区；`core/schedule.ts` 读取 `Date` 的本地字段（即进程时区），并用 `new Date(year, month, day, hour, minute)` 构造候选时刻；账本持久化的 `scheduler.timeZone` 每次加载都由 `Intl.DateTimeFormat().resolvedOptions().timeZone` 重新推导，除看板标题栏与客户端时间格式化外无人读取。

由此产生三个后果。

- **改动 `TZ` 会静默移动所有已排程规则。** 持久化的时区字符串只是展示信息，既有规则仍在新的时区下按同一段 cron 文本触发：一条「每天 09:00」的规则会随偏移差移动，既无用户操作也无变更记录。
- **墙上时间意图根本无法表达。** 用户希望 Host 运行在 UTC 时按上海 09:00 执行，没有任何表达方式，而 cron 文本本身承载不了这一信息。
- **时区在测试中是隐式的。** `tests/schedule-dst.spec.ts` 通过修改全局 `process.env.TZ` 建立时区，这是触达旧引擎的唯一途径，而不是任何规则自身的属性。

另外，日期字段的判定与 Vixie cron 存在分歧。旧实现只把字面量 `*` 视为不限定，因此 `0 0 *&#47;2 * 1` 这样的「步进星号 + 受限星期」会在所有步进日之外**额外**命中匹配的周一。上游 `@deepseek-ai/dsh-schedule` 依据字段文本是否**以 `*` 开头**来选择日期分支，使该表达式表示「落在步进日上的那些周一」。

## Decision

定时规则携带自己的 IANA 时区，cron 引擎在该时区而非进程时区解析墙上时间。

### 规则与其持久化

- `ScheduleRule` 新增可选字段 `timeZone?: string`。缺省表示跟随 Host 时区，即持久化时区之前写入的规则所沿用的语义。
- 账本 schema 升级到 v4。从 v2 或 v3 迁移时先证明每一行结构合法（会丢弃或强转行的文档仍然显式失败并保留原文件），再把当前 Host 时区盖到所有未存时区的规则上。盖章正是阻止既有规则跟随后续 `TZ` 变化的原因；触发时刻本身不变，因为已存的 `nextRunAt` 本就编码了旧时区。
- `normalizeSchedule` 只在该运行时能解析时才保留已存时区，因此拼写错误或本 ICU 构建缺失的时区会被清除（规则回退到 Host 时区），而不是让之后每次解析都失败。
- `applySetSchedule` 拒绝不可用时的时区，并以参数形式接收 Host 时区，使回退是显式的而非在用例内部重新推导。`applyCreateTask` 增加同一参数，并拒绝请求中不可用的时区，而不是静默地重新解释它。

### 引擎

`nextRunAtMs(expr, fromMs, timeZone?)` 通过按请求时区缓存的 `Intl.DateTimeFormat` 读写墙上时间。`zonedEpoch` 在朴素猜测前后各一天探测该时区偏移，保留所有能反解回请求字段的候选偏移：无解说明该墙上时间不存在（春季跳变空洞），该日期被跳过；多解说明该时刻有歧义（秋季回拨重叠），取最早时刻，使重复的钟点只触发一次。

日期门控改为遵循 Vixie：`dayStarred`/`weekdayStarred` 依据字段文本是否以 `*` 开头读取，两个字段都受限时为 OR，其余组合为 AND。

### 各层接口

- action 协议在 `set-schedule` 与创建时的 `schedule` 上接受 `timeZone`，并在线路边界校验（`null` 清除已存时区）；`task_board_schedule` 接受 `timeZone` 参数，并把空字符串定义为清除方式，使模型无需输出 JSON null。
- cron 触发的运行会在 Prompt 中说明自身的触发时刻（UTC）、规则时区与表达式。此前同一张卡片的 cron 运行与手动运行会入队逐字节相同的 Prompt，让 agent 只能从 Host 时钟推断「现在」——而这正是显式时区要消除的歧义。手动运行不携带定时段落。
- 详情面板与新建任务对话框新增时区选择器，选项来自 `Intl.supportedValuesOf('timeZone')`，Host 时区作为第一项（即清除已存时区的那一项）。两个编辑器都把下次运行显示为**规则所在时区**的绝对墙上时间加上括号内的相对距离，并由 Host 实际用于排程的同一引擎计算。选择器只提供 Host 同样能解析的时区。
- agent 工具描述与包公告改为说明规则时区，而不再是「Host 本地时区」。

## Testing

- `tests/schedule.spec.ts` 覆盖显式时区解析（同一表达式在上海与 UTC）、春季跳变跳过、秋季回拨取更早时刻、进程时区回退、两种 Vixie 分支、星号标志与非法时区校验。
- `tests/schedule-zone.spec.ts` 覆盖选择器清单（Host 项居首、无重复、每个提供的 id 均可解析、Host 未报告时区时仍可用）以及相对与合并后的下次运行文案。
- `tests/host-ledger.spec.ts` 覆盖两条迁移分支：未存时区的 v3 规则被盖上 Host 时区并保留已提交时刻；已带时区的 v3 规则保留原时区。`tests/store.spec.ts` 覆盖时区往返与不可解析时区的修复。`tests/protocol.spec.ts` 覆盖线路门控，`tests/agent-tools.spec.ts` 覆盖工具参数（含空字符串清除），`tests/subtask-run.spec.ts` 覆盖定时运行的 Prompt 段落。
- 引擎与 `@deepseek-ai/dsh-schedule` 的解析器做了差分核对：12 个 IANA 时区（含 30 分钟与 45 分钟 DST 偏移、都柏林的负 DST、阿皮亚跨日期变更线跳变）约 30 万个决策时刻，零不一致；一次收敛核对确认相对旧实现的唯一行为变化就是星号开头的日期字段修复。
- 门禁：`pnpm typecheck`、`pnpm test`、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:scripts`、`pnpm emoji:check`、`pnpm aggregate:check`、`pnpm libs:check` 全部通过。

## 上游是实验性功能：需要复核什么

本次采纳语义所依据的每个包都是 `experimental` 轨道上的内部 `0.2.0-rc.1` 版本，挂载它们的 bundle 也是可选的那个：`dsh-experimental-schedule-bundle` 自己的 README 写明它在每个安装中都「ships switched off」（`OPTIONAL_BUNDLES` 收录它，插件管理器在 Official 分组中提供它）。本次验证所用的 profile 启用了该 bundle 但停用了 `ui-schedule`——即附件显示的「2 运行中、1 已停用」——因此看板的调度在两种状态下都必须保持正确。

**看板与它们没有任何运行时或构建期依赖。** `src/` 下对 `@deepseek-ai/dsh-schedule` 的唯一引用是 `core/schedule.ts` 里的出处注释：没有 import、没有 `inject` 条目、没有 peer 范围，`dsh-time-context` 更是完全未被引用。这些包甚至不在本仓的依赖集合中——与家族消费的其它 `@deepseek-ai/dsh-*` 包不同，它们只在启用了该实验 bundle 的安装里才能解析到。因此上游重命名、破坏性变更，或这些包被移除或转正，都不会破坏看板的调度，本次改动也不强制任何 cohort 升级。这也正是本节记录的是*如何复核*、而不是一个需要跟踪的依赖的原因。

会静默失效的部分，按可能性从高到低：

1. **引擎被断言与之相符的 DST 与 Vixie 语义。** 「逐字节一致」这一结论依据的是 Testing 中记录的差分核对。需要注意**什么不能**保护它：没有任何测试导入官方包；而且与其它 `@deepseek-ai/dsh-*` 包不同，它**根本不是本仓的依赖**——只在启用了该实验 bundle 的 DSH 安装中才能解析到。因此上游改规则时 CI 不会变红，该核对也无法在干净检出中直接重跑：它是读取已安装包的临时脚本，并未提交到仓库。重建它需要在带有该 bundle 的安装中解析 `@deepseek-ai/dsh-schedule`，导入其 `lib/types/domain.js`，并在同样的时区/时刻扫描上把 `resolveCronOccurrence(...).nextScheduledAt` 与 `nextRunAtMs` 对比。若未来的 `resolveCronOccurrence`（或其 `localInstant` / `canonicalizeCronExpression` 辅助函数）在秋季回拨重叠时改取**较晚**的时刻，或改变日期/星期分支的选择方式，看板会保留此处记录的行为，而 `core/schedule.ts` 中的注释则悄悄变成假话。任何触碰 `dsh-schedule` domain 模块的上游发布，都应重跑该核对，然后同步更新该注释与 Testing 段落。若日后因 cohort 升级再次审视本节，可考虑把该核对脚本提交到 `scripts/` 下，使其不再依赖临时解包。
2. **定时运行是否会重复申明自己的时钟。** 看板现在会在 cron 触发时追加自己的定时段落，因为 cron 运行与手动运行此前入队的是完全相同的 Prompt。这一分工只有在时间上下文仍是如今这种「可选、限流、环境式」注入（一个前置的 `agent/pre-step` 监听器，默认 10 分钟刷新）时才成立。若未来版本让时间上下文变为无条件注入，或由它自己申明触发/经过时间，就应重新审视该前言，避免一次定时运行携带两份时钟声明。
3. **对「委托」的否决是否仍然成立。** `## Alternatives considered` 中否决把看板运行交给 `ctx.schedule`，依据的是该服务不了解看板账本、权限门、run group 与子任务级联——而不是它不可用。若后续版本长出运行看板任务的接口，或看板自身的权威边界发生变化，这条否决值得重新阅读，而不是想当然。
4. **官方任务页是否更适合作为交叉链接的对象。** 此处 `ui-schedule` 是停用的。若这些包脱离实验轨道、自动化任务页成为正式界面，两个调度界面就会并排存在，届时对它们做交叉链接（而非任其互不知晓）可能比现在更合适。

**触发条件**：`dsh-schedule` 或 `dsh-time-context` 的上游发布，或任何移动了这些包的 SDK cohort 升级（`dev` 上的 cohort 提交遵循 `chore(sdk): move the official cohort to <version>` 模式）。一旦触发，就对新版本重跑差分核对，并与申明该预期的两处对齐——`core/schedule.ts` 中的注释与上方的 Testing 段落。本次改动的其余部分都不应需要重新审视。

## Alternatives considered

- **复用官方 `ctx.schedule` 服务（即附件中的自动化任务插件）作为看板的调度器。** 否决——该服务调度的是 Host 全局提醒，以原始会话中的后续消息投递；它拥有自己的记录存储与投递历史，完全不了解看板账本、权限确认门、run group 或子任务级联。把看板运行交给它会拆分本包整体设计的权威性根基：账本是一张卡片做什么、能做什么、开启了什么的唯一事实源。native-panel 笔记已出于同一理由否决过该方案。官方技术栈中真正可采纳的是其**语义**——每条规则显式 IANA 时区，以及空洞跳过、重叠取更早的 DST 策略——本次改动在看板自己的引擎中采纳这些语义，并以差分核对而非猜测来验证。
- **依赖 `@js-temporal/polyfill`（官方引擎所用）而非 `Intl`。** 否决——该引擎由插件的 host 与浏览器两侧共同导入，而本包的浏览器 bundle 纯度规则只允许平台种子表内的值导入。`Intl.DateTimeFormat` 不引入新依赖即可解析同样的墙上时间，上面的差分核对就是其行为一致的证据。
- **直接从 `@deepseek-ai/dsh-schedule/lib/types/domain.js` 导入官方解析器。** 否决——那是该包 `exports` 之外未索引的深层导入，且其模块图仍会触达 `@deepseek-ai/dsh-session`，进而触达 cordis。它还会让浏览器侧预览依赖一个 Host 侧服务包。
- **保持时区为 Host 全局，只在 UI 暴露。** 否决——规则仍按进程时区解析，`TZ` 变更缺陷依然存在，且完全无法表达「UTC Host 上的上海 09:00」。
- **触发时跟随 Host 时区，而不是在迁移时盖章。** 否决——那正是当前行为，也正是让已排程规则在用户无感知、无记录的情况下移动的原因。
- **保留「只有字面量 `*` 才不限定」的日期门控以避免行为变化。** 否决——Vixie 读法才是上游实现，也是写 `*/2` 搭配星期的人的本意；保留旧门控会让规则在用户并未指定的日期触发。

## Consequences

- 定时规则声明自己的时钟。修改 Host 的 `TZ` 不再移动已排程规则，用户也可以在 Host 之外的时区排程 09:00。
- 账本为 v4，v2 或 v3 文档在加载时迁移，并把 Host 时区盖到原本没有时区的规则上。迁移失败仍然显式报错并保留原文件。
- 墙上时间解析现在与官方 schedule 服务一致：空洞跳过，秋季回拨的歧义时刻只触发一次、取更早者。旧引擎的春季行为本就是「向前归一」；现在该日期被跳过，与上游一致。
- `0 0 *&#47;2 * 1` 这类「星号开头的日期字段 + 受限星期」改为 Vixie 读法。这是唯一的 cron 行为变化；对 24 个表达式的收敛核对未发现其他表达式的解析结果不同。
- 客户端用共享引擎计算下次运行预览，因此预览不会再与 Host 实际排程的结果不一致。本运行时无法解析的时区会回退到 Host 时区，而不会让编辑器失灵。
- 时区选择器是 `<select>`，而 value 匹配不到任何 option 的 select 会回退到第一项，并在下一次变更时把该值**保存**下去。由此有两处显式防护：「跟随 Host 时区」这一项始终存在（快照尚未报告时区时，控件不得停在某个无关时区上），且清单不做截断、并追加已存但清单中缺失的时区。初稿曾把列表截断到 300 项；一个真实渲染测试发现 Europe/London 被截掉，于是打开一条上海规则再改时区会静默写入另一个时区。这类失效正是渲染测试（而非仅有纯函数测试）存在的理由。
- cron 触发的运行 Prompt 不再与手动运行逐字节相同：它增加一个定时段落。标签、交接包与运行形态段落以及正文均未变，因此任务正文自身的 Prompt 缓存前缀不受影响。
