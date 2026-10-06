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
- **行 id 不与官方行重叠，`name` 保持恰好等于包名**：本包独立安装的行 id 是
  `ui-plugin-manager-update-check`；官方 `@deepseek-ai/dsh-web-app` 的 `ui-plugin-manager`
  归官方插件页（唯一注册 `sidebar.panellist` 的半区），两行必须并存——loader 同 id 后来者胜
  且不报错，重叠时侧栏「插件」入口与整个插件管理页静默消失（#1794）。行的 `name` 必须恰好是
  `@linxin666/dsh-client-ui-plugin-manager`：`dsh-client-modules` 只把浏览器半区挂在说明符等于
  包名的那一行上，改成家族子路径只挂 host 半区。host 半区的 cordis 插件名（`src/index.ts`）与
  行 id 同名，`LOCKED_ENTRY_IDS` 同时收录该独立行 id 与家族行 `web-ui-plugin-manager`；本包
  不变量由 `tests/bundle-row-id.spec.ts` 固定。聚合侧的家族行 id 与子路径 `plugin-manager` 由聚合
  清单的 `familyIds:` 映射钉住，不随本包独立行改名（见 dsh-web-all/AGENTS.md）。
- **列表级工具条只能插进官方页面的 chrome**：官方「插件」页不为「已安装」标题声明席位（它的
  扩展点是 `plugins.detail.*`、`plugins.item`、`plugins.bundle.config`、`plugins.row.config`
  与 `plugins.bundle.activation`），因此工具条由 `plugin-toolbar-mount.tsx` 直接插进
  `[data-plugin-panel] [data-plugin-group="bundles"]` 的标题元素，并用共享的
  `body-mutations.ts`（sync-shared 副本，勿手改）自查位；容器自持 React root，不做 DOM 改写。
  页面重绘/切走时容器自动挪位或摘除，重复 apply 通过 `TOOLBAR_MOUNT_SELECTOR` 去重。
- **批量更新策略放 core，不放 host**：`src/core/updates.ts` 是唯一策略源——只更新第三方
  （非 `@deepseek-ai/`）且 `compatible !== false` 的行；官方包随 DSH 本体升级，绝不批量改写。
  单页区块（`plugins.detail.section`）仍可对官方包做单包更新，那是用户逐条确认的动作。
- **重启三态，禁止臆造命令行**：`src/host/restart.ts` 判定并回传实际模式——`relaunch`
  （终端启动：detached helper 等旧进程退出后重放本进程自身的 execPath + argv，剔除
  `--inspect*`）、`shell`（打包桌面：只退出，由桌面外壳自己的恢复对话框重启）、`manual`
  （无终端/无法判定：不退出，界面提示手动重启）。判定是纯函数 `planRestart`，执行是
  `performRestart`（helper 起不来时降级为 `manual` 而不是让进程白白退出）。新增重启路径前
  先确认宿主真的能重启，不要把「重启」做成静默失败。
- **重启路由必须按方法区分**：`GET /api/plugin-manager/restart` 只读方案（无副作用），
  `POST` 才执行，其他方法 405。缺了这道守卫时，一个普通 GET（浏览器预取、直接输入 URL、
  误探测）就能停掉正在运行的宿主并弹出桌面外壳的崩溃恢复对话框（2026-09-30 实证）。
  界面必须先读方案再确认：确认面板写的后果必须与 `POST` 实际产生的后果一致。
- **桌面端的重启只能借道外壳，且必须在确认前写清后果**：打包桌面没有给 Web GUI 任何重启
  通道（preload 只暴露 `dshDesktop.updates.status/open/subscribe`，`app.relaunch()` 只能由
  外壳自己的恢复对话框触发），所以宿主退出必然产生一个错误样式的对话框并写崩溃报告。
  桌面端（`shell`）的确认面板里，主按钮仍是「确认重启」，但面板必须先写明：会出现官方的
  「应用无法启动或已意外停止」对话框、需在对话框里点「重启」、并会写一份崩溃报告；同时
  给出手动替代（退出应用后重新打开）。用户明确要求过「点确认就直接走官方对话框」，
  不要退回成「只有手动说明」。
- **双通道纪律**：运行时探测官方 `/plugin-installer` 通道，存在（DSHCode / 1.0.4
  checkout web）则全部走官方 RPC（单一写入器 = 官方安装器）；不存在（npm 发布的官方
  web）则走本包 host 半区的 loopback HTTP 网关——安装/卸载 spawn 官方 `dsh plugin`
  CLI（仍是唯一写入器），启停写 profile patch 的 `disabled` 覆盖行。
- **应用自有 profile 的更新走官方进程内管理器**：打包桌面启动（`facts.desktop`）里 CLI
  拒绝写该 profile（`dsh plugin --profile desktop …` 直接报错），更新必须经宿主挂载的
  官方 `pluginManager` 服务（`ctx.get('pluginManager')`，契约观察不 import）；其余运行时
  CLI 仍是唯一写入器，两条路径共用同一任务表、状态轮询与版本核对。
- **官方管理器 resolve 不等于成功**：它的 `change()` 包装器把失败折叠进返回值
  （`application: 'failed'` / `'cancelled'`，附 `error.code` / `error.diagnostic`），而不是
  抛错。原生安装/更新/卸载必须先经 `nativeManagerFailure()` 读该判定再重读 profile，
  否则会把 pnpm 已经拒绝的运行报成「官方插件管理器报告成功，但…未生效」，把真实原因
  （例如 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）藏起来。判定形状见
  [更新路径记录](../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-manager-app-owned-update-path.md)。
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
- 共享件副本：`src/mount-once.ts`、`src/host/loopback.ts`、`src/host/dsh-home.ts`、
  `src/client/body-mutations.ts` 由 `scripts/sync-shared.mjs` 生成，禁止手改。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-plugin-manager typecheck
pnpm --filter @linxin666/dsh-client-ui-plugin-manager test
pnpm --filter @linxin666/dsh-client-ui-plugin-manager build
```
