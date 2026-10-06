# Agent Note: The Skill Center Manages the Custom Roots the Provider Row Declares

Status: implemented

## Problem

技能中心按 `ctx.skills` 注册表报告的 `source` 对技能分组。官方
`dsh-skill-filesystem` provider 在某个 `customSkillDirs` 根下发现的技能因此会渲染在
「自定义目录」分组里——但没有启用开关、没有编辑、没有删除，也没有路径行。这些控件全部
静默缺失，写路由返回 `404 {"error":"skill <name> has no editable file"}`。

面板的可编辑路径只来自它自己的文件系统扫描（`collect.ts`），而注册表补充条目刻意不暴露
路径（注册表条目不是被扫描到的文件）。于是该分组完全由无路径的注册表条目填满，写路由的
「最新扫描身份校验」（`resolveScannedSkill`）永远匹配不上。

扫描从未看到这些根的原因：插件只从**自身** config 读取 `customSkillDirs`。官方文档把这个
配置项放在 profile patch 的 **`skill-filesystem` provider 行**上，出厂的 web profile 也
正是如此（`presets/cordis.patch.yml` 用这种方式声明一个内置技能目录）。因此 host 平面的
插件 config 始终为空，没有任何自定义根被扫描，该分组里只剩注册表条目。

写路由还独立存在第二个缺陷：它仅用 `DEFAULT_CWD()`（`process.cwd()`）解析工作区，而
list 路由按「显式 `?cwd=`、活动会话工作区、进程 cwd」的顺序解析。web server 进程从 DSH
安装目录运行，因此在任何 cwd 不等于会话工作区的宿主上，写路由会重新扫描一个与 list 路由
刚刚展示的不同的项目根，并对面板正在显示的技能返回 `409 ... refresh and retry`。

## Decision

扫描既读本插件自身 config 的 `customSkillDirs`，也读每一条在用的 `skill-filesystem`
loader 行的同名配置；写路由通过与 list 路由相同的辅助函数解析工作区。

1. `collect.ts` 导出 `customSkillDirsFromLoader(entries)`：遍历在用的 loader 条目，挑出
   模块说明符为 `@deepseek-ai/dsh-skill-filesystem`（或 `.../dsh-skill-filesystem`
   子路径）的行，并从 `entry.options.config`（原始 profile patch）与 `entry.fiber.config`
   （已解析配置，loader 已在此完成 `!!js` 表达式插值）两处读取 `customSkillDirs` 字符串
   数组。枚举失败时降级为空贡献，而不是让扫描失败。
2. `collect.ts` 导出 `normalizeSkillRoots(dirs)`：丢弃空项、用 `resolve()` 把每项解析为
   绝对路径并去重。官方 provider 以同样方式解析其配置根，因此扫描出的身份与写路由之后重新
   解析出的路径一致。
3. `index.ts` 把插件自身 config 与 loader 派生的根合并，并把**解析函数**（而非冻结数组）
   传给路由，因为一次 profile reload 可能在请求之间替换这些行。loader 以非严格方式读取并
   加保护，因为它不是本插件声明的依赖。
4. `routes.ts` 通过 `panelCwd(override)` 解析工作区——显式覆盖、活动会话工作区、进程 cwd
   ——list 路由、健康探测与每一次 `resolveScannedSkill` 调用都用它。两半不再可能不一致。
5. 列出但没有本地文件的技能会带「无本地文件」标记与一行说明，而不是渲染一个控件静默缺失
   的行。

## Scope

只有 host 平面的 `skill-filesystem` 行会贡献根，因为只有它们是宿主能枚举的 loader 条目。
仅通过某个 agent preset 自己的 `customSkillDirs` 或 preset 作用域 provider 到达 agent 的
技能仍在面板覆盖范围之外，与
[The Skill Center Lists What the Official Provider Loads](2026-10-03-skill-center-lists-official-loadable-skills.md)
所记录的一致；本次改动为官方推荐的配法收窄了那里记录的已知缺口，但不声称已完全关闭它。

## Alternatives considered

**让 `serializeRegistry` 信任 `resourceBase.path`。** 注册表会为文件系统发现的技能报告
一个 `resourceBase` 目录，因此不扫描任何东西也能给自定义条目一个路径。否决：写路由的整个
安全属性就是只改动**最新扫描**产出的路径（见包 README 的安全模型），所以注册表路径无论如何
都要由一次扫描重新校验。不做该校验就信任它，会让过期注册表条目把写操作指向任意目录；而带上
校验再信任它，正是本次改动实现的扫描——只是少了发现这些根的能力。

**枚举 agent preset 作用域，让面板目录与模型完全一致。** 否决理由与 owning note 记录的一致：
面板不持有 per-agent scope key，且读取注册表时不带 viewing scope。造一个等于发明官方注册表
并未向 host 平面读取方提供的机制。

**直接读取 profile patch 文件。** 否决：那会把 loader 的组合、插值与分层规则（profile
patch、bundle patch、用户覆盖、`!!js` 求值）在第二份实现里重复一遍，而它可能与实际加载的
内容静默不一致。

**改为镜像官方 provider 的 rank 表。** 不适用：rank 表本就存在且正确。缺陷从来不是优先级，
而是根从未被扫描，因此根本不存在可供比较优先级或携带路径的文件系统条目。

## Consequences

- 配在 provider 行 `customSkillDirs` 根下的技能会带真实路径出现在自定义分组中，其开关、
  编辑与删除都作用于它自己的 SKILL.md。
- 路由族的两半解析同一个工作区，因此无论宿主进程 cwd 在哪，项目技能都可管理。
- bundled 或运行时注册不再看起来像坏掉的行：它会说明自己没有本地文件。
- 两处都声明的根只扫描一次，相对路径条目按官方 provider 的解析方式解析为绝对路径。

## Testing

`tests/collect.spec.ts` 新增五个用例：provider 行的根被扫描且带可编辑路径；空白/重复/相对
根归一为一个绝对列表；非 `skill-filesystem` 行不贡献任何根；条目树抛错时降级为空贡献；
仅存在于已解析 `fiber.config` 的根也会被读取。`tests/routes.spec.ts` 新增五个用例：list
路由带路径提供行配置的自定义技能；set-enabled 返回 200 而非报告中的 404 并写入 frontmatter；
delete 把它移入 `.trash`；解析函数抛错时仍能提供列表；当进程 cwd 是另一个持有同名技能的
项目时，项目技能仍可启停（写路由不得返回 409）。`tests/host-apply.spec.ts` 新增端到端
用例：一个 loader 携带 provider 行的假宿主，经真实路由提供该根的技能及其路径。全部十一个
用例在修复前源码上失败；包测试套件通过（145 项）。
