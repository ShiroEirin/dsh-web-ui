# Agent Note: 技能中心把「未声明调用字段」视为可调用

Status: implemented

## Problem

技能中心把每一个技能都显示为不可调用（「不可 /名称 · 模型不可调」），包括 frontmatter
里既没有 `user-invocable` 也没有 `disable-model-invocation` 的技能。一个装了 50 个
技能的环境里 50 个全部误报；技能实际上一个都没被禁用，所以显示与宿主机真实的调用判定
相矛盾，让一个健康的安装看起来像整体失效。

`packages/dsh-skill-explorer/src/collect.ts` 中两处缺陷共同导致该现象：

1. `serializeRegistry()` 把缺失的注册表策略兜底成 `false`：
   `modelInvocable: skill.invocation?.modelInvocable ?? false`。官方语义恰好相反——省略即允许。
2. `collectSkills()` 随后把这些序列化值**无条件**写回同名的文件系统条目，丢弃了
   `scanSkillRoot()` 已经按官方规则从文件解析出的正确值
   （`parsed.disableModelInvocation !== true`、`parsed.userInvocable !== false`）。

影响面仅限显示：宿主通过官方注册表判定真实可调用性
（`isModelInvocable(skill) => skill.invocation.modelInvocable`），因此技能一直可用，
只是面板的显示与之相反。

## Decision

技能中心把「缺失的调用策略」按官方语义视为「允许」，并且不让注册表的兜底值覆盖
从文件解析出的值。

1. `serializeRegistry()` 中，没有 `invocation` 策略的注册表条目兜底为
   `modelInvocable: true` / `userInvocable: true`。这与 `ctx.skills.register()`
   的默认（`{ modelInvocable: true, userInvocable: true }`）以及
   `dsh-skill-filesystem` 的 `parseInvocationPolicy()`（`disableModelInvocation !== true`、
   `userInvocable !== false`）一致。
2. `collectSkills()` 的注册表合并现在**仅在注册表候选确实给出该字段时**才修正
   `modelInvocable` / `userInvocable`，因此不带策略的候选不会破坏已解析的 frontmatter 值。
   `whenToUse` 与 `provider` 保持原有的「有值才填充」行为。

对于带可编辑文件的技能，事实来源仍是该文件自身的 frontmatter，由本包的
`parseFrontmatter()` 解析；注册表是补充，而不是凌驾于文件声明之上的权威。

## Official contract this follows

对照 DSH 0.2.0-rc.2 源码核实：

- `dsh-skill` 的 `register()`：`invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true }`。
- `dsh-skill-filesystem` 的 `parseInvocationPolicy()`：`modelInvocable: disableModelInvocation !== true`、
  `userInvocable: userInvocable !== false`。
- `validateInvocation()` 对 `undefined` 直接返回，因此 provider 完全可以合法地返回
  完全没有 `invocation` 的候选；这种「沉默」表示允许，绝不表示拒绝。

对上游 issue 的一处更正：issue 推测 `snapshot()` 是 invocation-neutral 的、因此永远拿不到
`invocation`。在 rc.2 上并非如此——`toSummary()` 会把 `invocation` 复制到每个 summary 上。
实际故障来自「provider 未给出该字段」叠加「兜底方向相反」，而不是注册表结构性地丢弃了字段。

## Alternatives considered

改用 `ctx.skills.get(name)` 取 invocation（它返回带 `invocation` 的完整
`SkillDefinition`），而不是合并 registry snapshot。这样官方注册表就是唯一事实来源。
但被否决：`get()` 会为每个名字加载并校验完整技能正文，list 路由每次轮询都要为每个技能
多一次文件读取加校验，而对本包已经解析过的技能毫无增益。面板无论如何都需要自己扫描
path、level、workspace 与链接技能信息，注册表 summary 并不携带这些，所以扫描必须保留。

彻底用 `ctx.skills.list()` 取代文件系统扫描。web profile 只在 agent preset 作用域层挂载
skill-filesystem provider，host 平面无法从注册表读到项目级与用户级技能；这次扫描是承重结构，
而不是便利性取舍。

保留注册表快照作为权威、只把兜底改成 `true`。这能修掉 issue 描述的症状，但会留下真正的
优先级缺陷：声明了策略的注册表候选仍会覆盖文件自身的 frontmatter，而过期或不匹配的注册表
会与面板实际编辑的文件静默矛盾。把覆盖限定为「字段存在时才发生」同时修好两者。

## Consequences

- 技能中心不再把健康的技能显示为已禁用；真正被禁用的技能仍通过其显式 frontmatter 字段
  正确显示为禁用。
- 仅由注册表插件声明为不可调用的技能显示依然正确——注册表给出策略时仍会修正这些标记。
- 该缺陷仅影响显示，因此宿主调用行为没有变化；两处默认值现在与官方规则一致，而不是相悖。

## Testing

`packages/dsh-skill-explorer/tests/collect.spec.ts` 用五个用例锁定该行为：省略字段仍可调用、
显式字段被尊重、不带策略的注册表条目不覆盖已解析值、显式的注册表策略仍能修正条目、
以及仅注册表存在的技能默认可调用而显式拒绝的仍被拒绝。该套件 128 项测试全部通过，
且新增用例在修复前的 `collect.ts` 上会失败。
