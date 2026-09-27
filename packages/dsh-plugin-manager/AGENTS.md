# AGENTS.md — dsh-plugin-manager

DSH web GUI plugin dsh-plugin-manager. 包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 本包向官方「插件」面板（`main` 面板 id `plugins`）声明的 `plugins.detail.section` 席位贡献
  一个「检查更新」区块（id `family-update-check`，order 30），只渲染在已安装组合包的页面上；
  它不注册 `settings.plugins.tab`，也不拥有自己的设置分区——安装/卸载/启停由官方页面负责，
  本包只补官方页面没有的 registry 更新检查与 DSH 运行时兼容门禁。
  该席位是官方 list 槽，类型由官方页面运行时声明；本包在 `PluginUpdatePatch.tsx` 内以同形
  `declare module` 重新声明（跨包禁止 value import，与家族卡片复用
  `plugins.bundle.config` 的做法一致）。宿主交付的 `PluginPageSubject`（`bundle` / `row` /
  `item`）是契约观察，不是 import。
- **双通道纪律**：运行时探测官方 `/plugin-installer` 通道，存在（DSHCode / 1.0.4
  checkout web）则全部走官方 RPC（单一写入器 = 官方安装器）；不存在（npm 发布的官方
  web）则走本包 host 半区的 loopback HTTP 网关——安装/卸载 spawn 官方 `dsh plugin`
  CLI（仍是唯一写入器），启停写 profile patch 的 `disabled` 覆盖行。
- **应用自有 profile 的更新走官方进程内管理器**：打包桌面启动（`facts.desktop`）里 CLI
  拒绝写该 profile（`dsh plugin --profile desktop …` 直接报错），更新必须经宿主挂载的
  官方 `pluginManager` 服务（`ctx.get('pluginManager')`，契约观察不 import）；其余运行时
  CLI 仍是唯一写入器，两条路径共用同一任务表、状态轮询与版本核对。
- **CLI 是 Node 脚本时不能用 shebang 直接 spawn**：GUI 启动的宿主（桌面应用）PATH 里没有
  `node`，`#!/usr/bin/env node` 会在 CLI 启动前以 `env: node: No such file or directory`
  （退出码 127）失败。用 CLI 旁的 `node`（npm-global/homebrew 布局），否则用
  `process.execPath` 执行脚本，并把 CLI 所在目录放到子进程 PATH 首位——`dsh plugin`
  转发的 pnpm 就在那里。
- 网关安全：所有 `/api/plugin-manager/*` 路由必须经 `isLoopbackRequest` 门禁；
  set-enabled 写文件走备份 + tmp + rename；不改其它写入器的行（insert 格式行内层
  `disabled` 除外，见 `src/host/rows.ts`）。
- 目录分区：`src/index.ts` host 半区（网关挂载）；`src/host/` 网关实现（profile
  解析、行编辑、CLI 作业、路由）；`src/client/` browser 半区（更新区块 UI、槽位注册、
  双通道封装）；`src/core/` 两侧共享纯逻辑（wire 解析、层 diff、冲突行形状）。
- **启动 profile 解析**：桌面端启动器通过 `runProfile({ profile: 'desktop' })` 启动，
  既不传 `--profile` 也不导出 `DSH_PROFILE`，因此 `resolveProfile()` 除 argv 与环境外
  还必须读宿主发布的 `profileContext`（可选 `ctx.get`）以及启动器 argv 里位置参数携带的
  profile 目录（Electron 会剥掉 exec 开关，故桌面宿主 argv 形如
  `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, …]`）。优先级为显式
  `--profile`、已发布 profile、argv 启动目录、`DSH_PROFILE`、`web` 子命令、桌面端
  持久化选择，别无来源时保持休眠（不猜测 profile）。已发布事实按外来输入处理：名称做
  穿越校验，`dir` 必须为绝对且
  无穿越的路径，`patchPath` 只在等于该 profile 自己的 `cordis.patch.yml` 时接受
  （它是写入目标）；`desktop` 只由启动器事实决定，不由 profile 名称推断。详见
  [Agent Note](../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-manager-desktop-launch-profile.md)。
- wire 形状镜像官方 `ui-settings-plugin-installer` 的协议（DSH 源码 checkout），是
  契约观察而非 import；形状变化时更新 `src/core/protocol.ts` 与测试。
- 已随「插件管理」Tab 移除的能力（`src/core/repair.ts`、修复会话、安装冲突 UI、
  安全模式横幅、只读清单与子插件展开）不要再以 client UI 形式加回：host 侧的冲突 / notice
  台账（`GatewayJob.conflicts` / `notices`）保留为可观测事实，但没有渲染方。
- 共享件副本：`src/mount-once.ts`、`src/host/loopback.ts`、`src/host/dsh-home.ts`
  由 `scripts/sync-shared.mjs` 生成，禁止手改。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-plugin-manager typecheck
pnpm --filter @linxin666/dsh-client-ui-plugin-manager test
pnpm --filter @linxin666/dsh-client-ui-plugin-manager build
```
