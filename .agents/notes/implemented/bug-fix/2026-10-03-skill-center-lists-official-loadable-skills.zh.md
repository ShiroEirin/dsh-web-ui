# Agent Note: 技能中心只列出官方 provider 会加载的技能

Status: implemented

## Problem

技能中心把文件系统扫描与 `ctx.skills` 注册表合并展示，但扫描用的是自己的接受与优先级
规则，而不是官方规则。结果是面板与模型目录在两个方向上都对不上，同名技能还可能显示成
模型根本收不到的那一个。

缺陷来自 `packages/dsh-skill-explorer/src/collect.ts` 与 `src/routes.ts` 三处：

1. **接受规则。** 扫描只要目录里有 `SKILL.md` 就列出，frontmatter 没写 `name` 时回退用
   目录名，没写 `description` 时显示 `(no description)`。官方 `dsh-skill-filesystem`
   provider 会丢弃缺少 frontmatter 或缺少任一字段的文件（`stringField` 要求非空字符串），
   也会丢弃非法技能名。
2. **名字文法。** 面板用 `/^[a-z0-9][a-z0-9-]*$/` 校验，且 `routes.ts` 与 `collect.ts`
   各写了一份。官方 `isSkillName` 是 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`。`a-`、`a--b`、
   `a-b-` 能过面板、过不了注册表，于是创建路由能写出一个宿主永不加载的技能。
3. **优先级。** 扫描让文件系统条目无条件赢得同名冲突，注册表只用来补 `whenToUse` 与调用
   开关。官方注册表在同一 layer 内按来源 rank 决胜：项目 `.dsh/skills` 100、项目
   `.agents/skills` 200、运行时 250、自定义 300、用户 `~/.dsh/skills` 400、用户
   `.agents/skills` 500、内置 600。同名的一个用户技能（500）与一个运行时注册（250），
   在面板和模型里胜者不同。

在运行中的桌面实例上实测：某个项目 `.agents/skills` 下两个完全没有 frontmatter 的文件
——`futures-risk-checklist` 与 `global-risk-checklist`——被列出，描述显示
`(no description)`、`modelInvocable: true`，而官方 provider 两个都不加载。既有测试还
把这个行为钉住了：夹具 `zebra-skill` 断言了 `(no description)` 回退。

## Decision

扫描按官方规则接受、命名与排序技能，写路由与它共用同一条名字定义。

1. `scanSkillRoot` 跳过 frontmatter 里得不到非空 `name` 或 `description` 的文件，并跳过
   不满足官方文法的名字。被扫描的文件没有目录名回退，也没有 `(no description)` 占位。
2. `collect.ts` 导出 `isSkillName`，由官方 pattern 支撑；`routes.ts` 每个名字校验都调它，
   不再保留第二份副本。面板接受的名字就是注册表会加载的名字。
3. `SKILL_SOURCE_RANK` 承载官方各来源 rank，注册表合并时与扫描条目的 rank 比较：更弱的
   注册表候选忽略，更强的替换该条目，同 rank 候选照旧补 `whenToUse`、`provider` 与已
   声明的调用策略。扫描自身的跨根合并复用同一张表。
4. 用户 `.dsh/skills` 根跳过保留目录 `.system`，与官方 provider 一致。

面板保留创建能力，只是接受的名字文法收窄到官方那一套。

## 定位与契约边界

这是一个纯 GUI 管理层，位于官方 skill 子系统之上：它读官方根与官方注册表，只写官方
provider 自己也会加载的 SKILL.md。它不注册 provider、不随包分发技能内容、不改变加载或
注入语义。

面板覆盖范围精确地是：它扫描的文件系统根，加上 `ctx.skills` 的全局层（bundled 与 runtime
条目）。仅通过某个 agent preset 自己的 `customSkillDirs` 或 preset 作用域 provider 到达
agent 的技能不在此覆盖范围内，因为面板读取注册表时不带 viewing scope。因此面板里没有的
技能，不一定模型也没有；会话能加载什么以官方 `skill` 工具目录为准。要补上这个缺口，需要
按 agent 作用域读注册表，而面板侧没有任何 handle 能拿到该作用域，所以这里把边界写清楚，
而不是造一个桥。

本 note 拥有技能中心的技能目录对齐。它依赖的调用策略规则由
[Omitted Invocation Fields Mean Invocable in the Skill Center](2026-10-03-skill-explorer-invocation-omission-means-allowed.md)
拥有；工作区呈现由
[Skill Explorer multi-workspace presentation and isolation awareness](../feature/2026-09-07-skill-explorer-workspace-isolation.md)
拥有。两者均未被取代。

## 遵循的官方契约

对照 DSH 0.2.0-rc.2 源码核实：

- `dsh-skill` `isSkillName`：`SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`。
- `dsh-skill-filesystem` `parseSkillFile`：frontmatter 缺失、`name` 或 `description` 不是
  非空字符串、或 `isSkillName(name)` 为假时，warn 并返回 `undefined`。
- `dsh-skill-filesystem` rank 常量：`PROJECT_DSH_RANK = 100`、`PROJECT_AGENTS_RANK = 200`、
  `CUSTOM_RANK = 300`、`USER_DSH_RANK = 400`、`USER_AGENTS_RANK = 500`、
  `BUNDLED_SKILL_RANK = 600`；`dsh-skill` `RUNTIME_RANK = 250`。
- `dsh-skill-filesystem` `roots()`：用户 `.dsh/skills` 根带 `skipSystem: true`。

## Alternatives considered

**从 `ctx.skills` 读官方接受结果，而不是自行推导。** 拒绝，理由与调用策略 note 记录的一致：
web profile 只在 agent-preset 作用域层挂 `skill-filesystem`，host 平面无法从注册表读到项目
或用户技能。扫描是承重的。

**用值导入 `@deepseek-ai/dsh-skill-filesystem` 替换面板自己的解析。** 拒绝：它的入口导出的是
provider 插件而不是解析辅助函数，且它是面板并不依赖的运行时 peer。为两条纯正则与一处归一化
引入依赖不值得。改为镜像规则，并在代码注释里点名官方来源。

**把 `isSkillName` 放宽成超集，让面板接受任何注册表可能接受的名字。** 拒绝：真值方向恰好
相反。面板接受而注册表拒绝的名字会产出一个静默永不加载的技能，正是本 note 要消除的失败。

**让面板枚举 agent preset 作用域，使目录与模型完全一致。** 拒绝：面板没有任何 per-agent
scope key，硬造一个等于发明官方注册表并未向 host 平面读者提供的机制。改为记录边界。

## Consequences

- 面板与模型目录在面板覆盖的每个根上就接受、命名与同名决胜达成一致；那两条活体幽灵条目消失。
- 只把文件放进技能根、frontmatter 无效的文件不再列出，这是用户可见的列表收缩。
- 创建与编辑路由不再能写出或接受注册表会拒绝的名字。
- `tests/collect.spec.ts` 去掉钉住缺陷的 `(no description)` 断言，并保留无 frontmatter 文件
  作为回归输入。

## Testing

`packages/dsh-skill-explorer/tests/collect.spec.ts` 新增五个用例：官方 provider 会丢弃的文件
不出现在列表；共用的名字守卫在接受与拒绝样例上与官方文法一致；运行时注册胜过同名用户技能；
项目技能仍胜过同名内置候选并保留可编辑路径；保留目录 `.system` 永不列出。
`tests/routes.spec.ts` 新增写边界用例：create 路由拒绝 `bad-`、`bad--name` 与 `a-` —— 
这些名字旧面板文法接受、注册表拒绝。整包套件通过（134 个用例），每个新用例都对它覆盖的
修复前源码变红。
