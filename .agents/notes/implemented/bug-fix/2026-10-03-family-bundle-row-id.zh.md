# Agent Note: 家族 bundle 行自有 loader id

Status: implemented

## Problem

loader 行 id 共处一个全局 id 空间，每个 id 只留一条、后来者胜，且**不报任何错**：`@deepseek-ai/cordis-plugin-loader` 用 `Object.fromEntries(config.map(options => [options.id ?? Symbol('anonymous'), options]))` 建条目表。复用别的 bundle 已占用的 id 不会被拒绝，先到的那一行被静默丢弃，它所属的插件提供的 UI 随之消失。

`@linxin666/dsh-client-ui-plugin-manager` 认领了 `ui-plugin-manager`，而这是官方 `@deepseek-ai/dsh-web-app` bundle 为 `@deepseek-ai/dsh-client-ui-plugin-manager` 用的 id。两个半区并不可互换：只有官方 browser 半区注册 `sidebar.panellist`——侧栏「插件」入口的席位；而本包的 browser 半区只在官方插件页上注册 `plugins.detail.section`。官方行被丢弃后，侧栏「插件」入口消失、插件管理页不可达，「检查更新」区块也失去宿主页面。全程没有日志，设置里的只读插件列表照常渲染，profile 看起来一切正常（[#1794](https://github.com/zhu1090093659/dsh-web/issues/1794)）。

安装期守卫同样没拦住。`CliGateway.detectDuplicateClaims` 的已占用 id 集合来自 profile patch 自身的裸行，加上 profile **依赖**各自 bundle patch 认领的 id；而官方 web-app bundle 两者都不是：它的行来自宿主自己的 bundle 层。因此家族包与官方行撞名在安装期根本不可见——这正是 SDK cohort 兼容扫描唯一没覆盖的 loader 行名册。

最直觉的修法——给本包换一个独立安装行 id——撞上第二重约束。聚合包每个家族行 id 都由子包自己的行 id 派生（`namespaceId`），家族子路径导出又由该行 id 派生，所以改子包行 id 会连带改掉已发布的聚合行 `web-ui-plugin-manager` 与子路径导出 `@linxin666/dsh-web-all/plugin-manager`。而能让聚合保持稳定的那三个 id（`plugin-manager`、`ui-plugin-manager`、`web-ui-plugin-manager`）都已被占用：第一个属于官方 `@deepseek-ai/dsh-base` bundle，第二个属于官方 web-app bundle。也就是说，两个 id 空间不解耦，本次要求的修复就无解。

## Decision

独立行走自己的命名空间，聚合清单钉住它挂载该子包时用的家族行，于是没有任何已发布标识符跟着移动。

- 本包独立安装的行是 `ui-plugin-manager-update-check`，官方 `ui-plugin-manager` 行保留自己的条目，两个插件各自挂载。行 `name` 保持恰好 `@linxin666/dsh-client-ui-plugin-manager`：官方 `@deepseek-ai/dsh-client-modules` 经 loader 行挂 browser 半区时，要求该行的说明符解析到该包自身的 manifest（`locatePkgJson` 把最近的 `package.json` 名与说明符比对），写成子路径形状只会挂上 host 半区，browser 侧区块直接死掉。
- host 半区的 cordis 插件名（`src/index.ts`）跟随行 id；`LOCKED_ENTRY_IDS` 同时收录独立行 id 与保持不变的家族行 `web-ui-plugin-manager`，挂载后的条目不产生同名歧义，负责人写操作的那两行仍被锁住。
- `aggregate.yml` 新增 `familyIds:` 段，把子包自己的行 id 映射到聚合挂载它时用的聚合行 id。`scripts/aggregate.mjs` 让行 id、家族子路径与 `patches:`/`inactive:` 目标都经该映射解析，其余行仍走派生默认，并拒绝死键、`web-ui-*` id 空间之外的取值，以及与别的行撞名的覆盖。生成的 patch、`./plugin-manager` 导出与 client-children 清单逐字不变。
- `tests/bundle-row-id.spec.ts` 对已交付文件钉住本包三条不变量：恰好一条 insert 行、`name` 恰好等于包名；行 id 既不在官方 bundle 行名册快照内（两个官方 bundle 都收，不只 `ui-*`），也不在其他任何家族包认领的 id 里；host 半区插件名等于行 id。`scripts/aggregate.test.mjs` 钉住家族侧：每个覆盖都在聚合 id 空间内、指向真实挂载的行、且不等于子包行 id，并断言 plugin-manager 家族行 id、子路径与导出在独立行改名后仍然存活。

随本次不发布任何 profile 迁移。id 来自包自己的 bundle patch，装上修复版就会重新推导出独立行；profile 早已熟知的聚合行分毫未动。

## Alternatives considered

只改独立行 id、让聚合跟着改名被否决：那要为每个聚合安装移动两个已发布标识符。家族行 id 正是 profile 用户层可以指向的那个 id，而本仓对家族行自有规则就是「行 id 逐字保持不变，老 profile 无需迁移」；曾覆盖过 `web-ui-plugin-manager` 的 profile 会以 `patch: entry not found` 告警启动、该行静默恢复启用，插件列表标题也会从 `web-all/plugin-manager` 变成 `web-all/plugin-manager-update-check`。给退役子路径补 tombstone 能保住导出解析，保不住行 id。

把这个子包从 `patchFrom` 改挂到自带显式 id 的外部 `rows:` 段被否决：外部行直接以真实包名挂载，该行会失去 fault-isolation shell，列表标题也会从家族子路径变成包名。

把行从本包 bundle patch 移走、改由普通 bundle 条目以包名挂载被否决：聚合的家族行正是从那条 insert 行派生的，行会随之消失。

保留原 id、改由本包注册 `sidebar.panellist` 席位被否决：该席位属于官方插件页，再注册一个语义相同的入口只会让侧栏出现两个竞争的「插件」入口，而不是恢复官方那个。

扩展安装预检、去读宿主自己的 bundle patch 并拒绝撞名认领，在这里被否决为不可验证。运行时解析 `@deepseek-ai/dsh-web-app/cordis.patch.yml` 会把网关耦合到宿主安装布局（npm、打包桌面外壳与源码 checkout 各不相同），它只在安装路径上运行、也修不了已经损坏的 profile，而且官方 id 的知识会因此住在两处：测试钉的快照与运行时解析。

选一个裸的 `plugin-manager` 独立行 id（正好命名空间回 `web-ui-plugin-manager`）被否决：读到完整官方名册后发现 `@deepseek-ai/dsh-base` 已占用该 id，等于把一次静默丢行换成另一次。

在同一次改动里把名册门禁扩到全部家族行，被否决为聚合层的横切决策：DSH 一旦新增官方 `ui-market` 之类的行，就会把一个无关包的测试变红，并把名册拖进每个包的测试里。

## Consequences

官方侧栏「插件」入口与官方插件管理页重新与本包的「检查更新」区块并存挂载；聚合安装侧毫无变化——家族行 id、子路径导出与列表标题逐字不变。

已装过本包的 profile 继续可用；曾通过本包 UI 停用过那条错名行的 profile，会留下一条失效的 `ui-plugin-manager` 用户层覆盖行。include patch 语义会跳过 `name` 与被插入条目 `name` 不一致的裸覆盖，而官方行的 `name` 是官方包名，因此该覆盖无法关掉官方条目。

测试里的官方名册是 `0.2.0-rc.2` 的 `dsh-base` 与 `dsh-web-app` bundle patch 快照，不是实时读取：本仓只基于已发布的官方 SDK 包构建，不依赖宿主的 bundle 树。DSH 后续新增与家族行撞名的行 id，要等快照刷新才会被发现——因此刷新方法写在测试文件头，家族规则指向它。

`familyIds:` 是逐行的逃生口，不是第二套命名策略：派生 id 仍是默认，覆盖除非留在聚合 id 空间内且指向聚合真实挂载的行，否则一律被生成器拒绝。

验证：`pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`、`pnpm test:scripts`、`pnpm aggregate:check`（生成产物逐字不变）与仓库合并门禁。行改动需要重启 DSH 才生效，当前会话不执行重启。
