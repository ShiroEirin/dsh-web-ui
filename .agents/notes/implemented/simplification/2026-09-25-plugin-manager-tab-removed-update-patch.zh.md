# Agent Note: 移除插件管理 Tab，把检查更新 patch 到官方插件页

Status: implemented

## 问题

`dsh-plugin-manager` 曾在官方「插件」设置分区注册自己的「插件管理」Tab（`settings.plugins.tab`，id `family-plugins`，order 20）。这个 Tab 已经失去了存在理由：安装、卸载与启停早已移交官方插件管理页，而面板归官方页所有，于是该 Tab 成了与本该拥有插件管理的页面相互竞争的第二界面。它剩下的部分——带聚合子行的只读清单、安装冲突对账、启动失败修复会话与安全模式横幅——都是官方页面不渲染的 UI，其中的清单还与官方页面从自身权威数据源绘制的清单重复。

官方页面真正缺的只有一件事：把已装插件与其 registry 来源提供的版本做比对，并加 DSH 运行时兼容门禁。

## 决策

「插件管理」Tab 被移除。`src/client/PluginManagerTab.tsx`、`tests/PluginManagerTab.spec.tsx`、`settings.plugins.tab` 注册，以及仅服务该 Tab 的 UI 逻辑一并删除；本包不再注册任何 `settings.plugins.tab` 条目。

替代它的是单独的更新检查，通过官方插件页声明的 `plugins.detail.section` 席位注入该页面（`src/client/PluginUpdatePatch.tsx`，id `family-update-check`，order 30）。官方页面在每个组合包 / 行 / 官方插件页面上为每份贡献渲染一个区块，并把页面的 `subject`（`{kind:'bundle',pkg}` / `{kind:'row',pkg,row}` / `{kind:'item',id}`）传下去；补丁只有在 subject 是已安装组合包时才渲染，因此它恰好出现在「可以把已装包与其 registry 来源比对」的位置。它绘制原生 `<button>` 与自己的区块，而不使用官方 primitives bundle，从而让该条目不依赖 loader 未必提供的模块。

随 Tab 一并移除（因为再无其它消费者）：`src/core/repair.ts` 及其字典键（修复 seed 构造器）、client 侧的 `parsePluginControlSnapshot` / `PluginControlItem` wire 解析、`diffControls` / `classifyChange` / `ControlChangeKind`、`failures()` / `status()` / `setSafeMode()` client face、`/plugin-control` RPC 通道的使用，以及仅 Tab 使用的 CSS。`src/core/conflict.ts` 只保留 `ControlChange` 行形状，即网关宿主记录的内容。

host 半区不变：每条 `/api/plugin-manager/*` 路由、CLI 网关、`GatewayJob` 上的冲突 / notice 台账、启动预检全部保留。`'pluginManager'` cordis 服务与其冻结的跨插件契约保留（`dsh-market` 消费它），其中 `failures()` 是刻意保留的：它是宿主记账，兄弟插件仍可观察，即便现在没有第一方界面渲染它。`dsh.client.inject` 列表去掉仅 Tab 需要的行（`api-session-controller`、`api-workspace-controller`、`ui-workspace`）与设置面（`ui-settings`，补丁不消费其槽位契约）；`ui-renderer` 保留，因为补丁注册所用的 `ctx.slots` 注册表由它提供。

## 已考虑的替代方案

- 把所有可迁移能力都迁进 `plugins.detail.section`：该席位按 subject 在某个页面上渲染，所以启动失败环不属于任何页面（它是插件级而非组合包级），冲突对账是安装事务的产物而非页面内容，而清单与启停本来就归官方页面所有。把它们拆成若干贡献等于在别人的页面里重建那个 Tab。
- 保留 Tab 并只在有更新时显示：一个空的或自我隐藏的 Tab 比没有 Tab 更糟，而管理插件的用户本来就在官方页面上。
- 把清单保留为补丁区块：它与官方页面从权威数据源渲染的内容重复，重复的清单会静默漂移。
- 为将来的修复界面保留 `repair.ts` 与其字典：无人使用的导出与无人使用的文案正是本次变更要消除的维护面；若修复界面回归，可从 git 恢复。
- 通过 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` 渲染补丁：官方 primitives 是经由模块表加载成员的闭包工厂 client bundle；原生 button 让该贡献自足。

## 后果

- 「插件」设置分区只显示官方 Tab；本包不再贡献任何 Tab，也没有第一方设置分区。
- 更新区块渲染在官方页面的已安装组合包页面上。它在显式点击时才检查，而不是挂载即检查——一次检查会读取每个已装插件的 registry 清单，页面访问不该触发这种扇出。
- 兼容门禁行为不变：区块标出声明的 DSH 最低版本，当宿主低于它时禁用更新动作，host 更新路由在无法核实时仍会在启动任何 CLI 任务前返回 412。
- 安装冲突台账与重复挂载 notice 仍会被记录并仍在网关任务 wire 上返回，但 GUI 中已无渲染方。若将来要改变这一点，必须有意识地新增消费者。
- `settings.pluginManager` locale 命名空间收缩为区块渲染所需的键；`dsh-i18n` 中的 ru 字典同步镜像，`pnpm i18n:check` 通过。
- `plugins.detail.section` 由官方页发布，因此该贡献通过 `ctx.slots.inject` 等待其声明——与家族插件卡片消费 `plugins.bundle.config` 用的是同一套写法。在官方页面未声明该席位的宿主上，该条目不会注册，本包其余部分照常工作。

## 测试

- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx`（10 个测试）：渲染位置（已安装组合包之外不渲染、非本机降级）、新版本 / 已是最新的检查结论、区块内的检查失败、连点保护、为页面所属组合包执行更新并给出重启提示、DSH 最低版本拦截，以及区块内的更新失败。断言读取区块的状态属性，因此版本错误或门禁缺失都会失败。
- `packages/dsh-plugin-manager/tests/service.spec.ts` 断言 `pluginManager` 契约形状、注册的槽位是 `plugins.detail.section`、补丁与服务共享同一 face，以及 `onChange` 语义。
- 已跑门禁：`typecheck`、`test`（201 个测试，16 个文件）、`build`、`pnpm i18n:check`、`pnpm emoji:check`、`node scripts/test-standards.mjs packages/dsh-plugin-manager`。
