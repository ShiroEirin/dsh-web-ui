# Agent Note: 创意工坊复用官方插件面

Status: implemented

## Problem

创意工坊商店卡片过去用自己的写入链路安装社区插件：家族 `pluginManager` cordis
服务（`@linxin666/dsh-client-ui-plugin-manager`）→ 该包的 loopback 网关 → 官方
`dsh plugin` CLI。在打包桌面客户端上 CLI 拒绝应用自有 profile
（`error: profile "desktop" is managed exclusively by the Electron application`），
所以一键安装恰好以这条消息失败；而官方插件页——它经 `ctx.remote.pluginManager`
驱动进程内管理器——一直在往同一个 profile 里安装（该管理器自己的操作日志
`~/.dsh/profiles/desktop/.plugin-manager/logs/` 记录了这些运行）。

商店此前没有使用的官方能力：

- `remote.pluginManager`——API gateway 把每个 remote 命名空间注册为服务
  `remote.<namespace>`；官方页用
  `installBundle(spec, { enabled, requestId, registry, approvedBuilds })` 安装，
  用 `removeBundle(name)` 卸载，用 `setBundleEnabled` 启停。
- `pluginNavigation`——官方插件页发布（provide）的 reflect 服务，
  `openBundle(packageName)` 会在其面板中打开某个组合包的页面。

## Decision

1. **宿主发布了官方 remote 面时，安装走它。** 卡片调用
   `ctx.remote.pluginManager.installBundle(spec, { enabled: true, requestId })`，
   并把 gateway 的 `{ ok, value | error }` 结果信封作为卡片自己的安装错误呈现。
   家族 `pluginManager` 面仍是"宿主未发布 remote"时的回退写入器；两者都没有时
   仍降级为复制命令索引。
2. **管理留在官方容器里。** 已安装条目提供一个管理动作，调用
   `pluginNavigation.openBundle(packageName)` 在官方「插件」面板中打开该组合包
   页面：启停、卸载与安装诊断流本来就在那里，商店不重复实现。该动作只在服务被
   桥接进来时渲染。
3. **两个面都是可选的，用 `ctx.inject` 桥接**（不用插件的模块级 `inject`
   数组），与家族 `pluginManager` 桥接一致；宿主两个面都不发布时，商店卡片仍完整
   渲染。
4. **两个面都是契约观察。** 不跨包 value import：商店调用到的成员（以及 remote
   结果信封）在 `src/client/native-plugin-faces.ts` 里就地重新声明——与家族桥接
   对 `PluginManagerService` 采取同一纪律。

## Alternatives considered

- **让家族网关继续做商店唯一的安装路径。** host 半区已经把应用自有 profile 路由到
  进程内管理器（见[安装路径记录](../bug-fix/2026-09-27-plugin-manager-app-owned-install-path.md)），
  因此这对已报告的故障已经足够。但作为商店的路径被否决：它为官方管理器已经在做的
  事情再保留一个写入器，还必须放宽网关的 CLI 门禁，也拿不到官方的安装诊断。那条
  host 侧路由保留为家族消费方（检查更新区块）与没有 remote 的宿主的回退。
- **在商店卡片里自己实现卸载、启停与进度。** 否决：重复官方容器，包括其确认与进度
  语义，而仓库规则要求以原生为基座。
- **把 `remote.pluginManager` 加进插件的 `inject` 数组（必需依赖）。** 否决：
  宿主不发布该面时整张商店卡片会静默消失，目录、点赞与资产安装会一起消失。
- **已安装快照也改用官方 `pluginInventory`。** 暂缓：家族面已经从宿主读取的
  profile 回答同一问题，卡片的匹配逻辑也以那套行形状为准；本次只需把安装写入器搬走
  就能修好故障。

## Consequences

- 打包桌面客户端上的一键安装可用：点击直接驱动官方管理器，不再 spawn CLI，并按
  `enabled: true` 为下次启动激活该 bundle。
- 商店不再依赖家族面来安装；该桥接保留用于已安装快照与回退写入。
- 皮肤、宠物与预设不变：它们没有官方对应物，继续走市场自己的
  `api/market/install-*` 网关。
- 客户端半区会被内联进聚合包，因此聚合安装必须重建
  （`pnpm build` + `node scripts/lib-artifact-check.mjs --write`）才能让改动进入
  实际服务的 bundle。

## Testing

- `packages/dsh-market/tests/market-card.spec.tsx`：注入官方 remote 面后，点击安装
  调用 `installBundle`，参数为该条目的 spec 与 `{ enabled: true }`，且从不调用
  家族写入器；管理器的拒绝就是卡片报告的失败；已安装条目的管理动作以已安装包名调用
  `openBundle`。
- `packages/dsh-market/src/client/install-source.test.ts`：`managePackageName`
  优先已安装行的 id、去掉声明 npm 名的版本/标签后缀、最后回退到条目 id。
- `packages/dsh-market/tests/client-apply.spec.tsx`：`apply()` 在"两个面都不
  发布"的上下文上跑通可选面桥接，并且仍只注册一个设置分区。
- `packages/dsh-market/tests/native-plugin-faces.spec.ts`：可选桥接在**真实的
  cordis context** 上被验证——provide `remote.pluginManager` 与 `pluginNavigation`
  之后，store 里正是这两个带点的服务名，撤销后又被清空；也就是说这条复用所依赖的
  注入机制是被验证过的，不是假设。
- 已在运行中的打包桌面宿主上做了端到端真机验证（正是本次改动针对的那台宿主），
  用 DevTools 协议加应用自身会话 cookie 驱动真实 GUI：
  1. `设置 → 创意工坊 → 插件` 渲染出商店卡片；已安装插件的行出现新的管理动作，而该
     动作只在 `pluginNavigation` 被桥接时才渲染——说明运行中的宿主确实发布了官方面。
  2. 对「免费搜索」点「一键安装」后，profile 新增依赖 `dsh-free-search ^0.4.39`，
     并新增一条官方管理器操作日志（`operation-NjSgmD/pnpm.log`，pnpm v11.7.0）——
     安装由官方进程内管理器完成而非 CLI，卡片随即变为「已安装」+「在插件页管理」。
  3. 点「在插件页管理」在官方「插件」面板打开了该组合包页面（dsh-free-search
     v0.4.39，可用「卸载」）。
  4. 「卸载」并确认后，同一个官方管理器移除该包，profile 回到验证前的依赖集合
     （`@eddyskywalker/dsh-chatgpt-subscription`、`dsh-better-sidebar`、
     `dsh-llm-verifier`、`dsh-web`）。
  用于验证的插件随后已被卸载，验证没有留下残留。API gateway 自己的注册规则（每个
  remote 命名空间都会成为名为 `remote.<namespace>` 的服务）加上这次运行共同说明：
  该宿主上卡片根本不需要家族写入器；若某宿主两个面都不发布，卡片会回退到家族面，
  以及安装路径记录里修好的 host 侧原生写入路径。
