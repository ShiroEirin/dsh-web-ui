# Agent Note: 应用自有 profile 上的插件管理器更新

Status: implemented

## Problem

在打包桌面客户端（DeepSeek Harness Electron 应用，DSH 0.1.7-rc.2，profile 为
`desktop`）上，点击本包「检查更新」区块里的**更新**会失败：
`操作失败：env: node: No such file or directory`。

来自运行中宿主的现场证据（pid 72345，argv 为
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
/Users/zcl/.dsh/profiles/desktop, …]`）：

- `ps eww` 显示宿主环境为 `PATH=/usr/bin:/bin:/usr/sbin:/sbin`——GUI 启动的进程既没有
  node 也没有 homebrew 前缀，而 `ELECTRON_RUN_AS_NODE=1` 表明它是 Electron 充当 Node 的宿主。
- `findDshBinary()` 依次落空于 PATH（无 `dsh`）与宿主入口探测（安装包的 `app.asar`
  里既没有 `node_modules/.bin` 目录，也没有 `dsh-desktop-host/lib/bin.js`），最后命中
  darwin 回退项 `/opt/homebrew/bin/dsh`——它是指向 `@deepseek-ai/dsh/lib/bin.js` 的
  符号链接，首行是 `#!/usr/bin/env node`。
- `dshSpawnCommand()` 在非 Windows 上原样返回该路径（旧注释：bin.js 带 node shebang，
  POSIX 直接执行即可），于是内核把 shebang 交给 `/usr/bin/env`，而它在该子进程 PATH 上
  找不到 `node`。精确复现：
  `env -i PATH=/usr/bin:/bin /opt/homebrew/bin/dsh --version` → 退出码 127，
  `env: node: No such file or directory`；网关把 CLI 的 stderr 尾部原样作为任务错误返回，
  正是面板渲染出的那行字符串。

另有两个事实决定了修复方式：

- 即使 spawn 修好，CLI 也无法写该 profile：`dsh plugin --profile desktop …` 以退出码 1
  报 `error: profile "desktop" is managed exclusively by the Electron application`
  （官方 `dsh` CLI 的 `rejectElectronProfile`）。打包启动器把自带运行时作为启动器事实交给
  宿主（`packageManager: { command: process.execPath, args: [--expose-internals,
  <runtime>/pnpm/bin/pnpm.mjs], env: { PATH: <runtime>/bin + delimiter + PATH } }`），
  因此应用自有 profile 是在进程内写入的，而不是经 CLI。
- 这个进程内写入器存在且已挂载：`@deepseek-ai/dsh-base` 插入了
  `id: plugin-manager, name: '@deepseek-ai/dsh-plugin-manager'`，其类继承
  `TypertRemoteService`，构造函数为 `super(ctx, "pluginManager")`——即键名
  `pluginManager` 的普通 Cordis 服务，带有官方插件页以
  `ctx.remote.pluginManager` 驱动的 `installBundle` / `removeBundle` 方法。

## Decision

1. **Node 脚本形式的 CLI 绝不经 shebang 执行。** `isNodeScript()` 按扩展名（`.js`、
   `.cjs`、`.mjs`）或 `#!… node` shebang 探测判定解析出的 CLI 路径是否为 Node 脚本；
   `dshSpawnCommand()` 随后用不依赖 PATH 的解释器执行它：安装包在 CLI 旁带 `node` 时用它
   （npm-global 与 homebrew 布局），否则用 `process.execPath`（Electron 宿主由既有的
   `ELECTRON_RUN_AS_NODE` 分支覆盖）。原生可执行文件与 shell 包装器仍按原样 spawn，
   头部读不到时回退到原先的直接 spawn。
2. **CLI 所在目录放到子进程 PATH 首位**（`withPrependedPath()`，把该键的所有大小写变体
   折叠成一个 `PATH`，即桌面 childEnv 记录过的 Windows 陷阱）。`dsh plugin` 会转发给
   pnpm，而 npm-global 与 homebrew 安装把 `pnpm` 与 `dsh` 放在同一目录；否则更新会启动后
   再因找不到 pnpm 而失败。
3. **应用自有 profile 的更新走官方进程内管理器。** `CliGateway` 经宿主半区提供的接缝读取
   `ctx.get('pluginManager')`，且仅在 `facts.desktop` 为真时使用：官方管理器负责解析
   registry、用启动器自带的工具链运行 pnpm 并应用 bundle。任务表、`/status` 轮询、变更队列
   与版本核对均不变，且只有依赖仍在 profile 中并报告路由解析出的版本才算 `done`——管理器
   报告成功却什么都没动，与 CLI 路径一样判为 `更新未生效` 错误。其余运行时仍以 CLI 为唯一
   写入器，行为不变。

官方管理器是契约观察而非 import：本仓基于官方 SDK 已发布包构建，且本包必须在没有挂载管理器
的宿主上照常运行。该路由仍位于 loopback 门禁与用户点击之后，与官方插件页调用同一服务时
的权威相同。

## Alternatives considered

- **只修 spawn，让 CLI 报出拒绝。** 否决：那样更新按钮会在该功能实际使用的运行时上以英文上游
  报错失败，而 DSH 不会放宽该规则——profile 属于应用。
- **只要挂载了官方管理器，就让全部操作都走它。** 暂不采用：npm web 运行时上的安装/卸载走 CLI
  路径，本网关存在的意义正是它那套对账保护（重复入口 id、引用不可解析包的 insert 行、
  重复挂载剥离、`--dump-config` 预检），而官方管理器有自己的一套。整体迁移是另一个决策，
  需要各自的证据。
- **应用自有 profile 时由网关直接运行 pnpm。** 否决：这会重复官方管理器的职责——registry
  规划、锁、bundle 激活、构建脚本审批——违背「原生 DSH 为基础」的仓规。
- **浏览器半区经 `ctx.remote.pluginManager` 访问官方管理器。** 否决：宿主半区与该服务同进程，
  客户端中转只会平添一层 wire 面、一个 `/mode` 标志与第三条客户端通道。
- **把应用自带运行时 bin 前置到 PATH，而不是解析解释器。** 否决：该 PATH 事实属于应用，其目录
  里只有 `node` 启动壳（没有 pnpm），而本包也必须服务于 CLI 启动的宿主。

## Consequences

- 打包桌面客户端上的「检查更新」更新可用：任务以 `done` 返回新版本行，面板随后显示重启提示。
  同一 spawn 修复也适用于网关在任意 GUI 启动宿主上的其他 CLI 调用（`--version` 探测、安装、
  卸载、迁移）。
- 原生更新路径不经过网关自身的保护；该处由官方管理器负责 registry 解析、pnpm 调用、profile
  锁与 bundle 激活，本网关在事后重读 profile 做核对。
- 改动在下次宿主启动后生效（host 半区是启动时加载的构建产物 `lib/index.js`）。

## Testing

- `tests/gateway.spec.ts`：`dshSpawnCommand` 对 `#!/usr/bin/env node` shim 选择同目录
  `node`，没有时选 `process.execPath`；`.js` bin 路径直接经解释器执行且不读取文件；原生
  二进制与 `#!/bin/sh` 包装器仍直接 spawn；头部读不到时回退直接 spawn。`withPrependedPath`
  在 POSIX PATH 前置、把 Windows 大小写变体折叠成一个键、环境无 PATH 时写入 PATH。
- `tests/gateway-jobs.spec.ts`：在 `desktop` 事实下更新经脚本化的官方管理器执行，CLI spawn
  接缝一旦被使用即抛错；管理器失败以任务 error 落定并带其消息；管理器报告成功但版本未变的
  绿灯判为 `更新未生效`；非桌面 profile 上 CLI 仍是写入器，管理器不被触碰。
- 针对真实安装现场复现了 spawn 缺陷与修复：旧形态退出码 127 且
  `env: node: No such file or directory`；在宿主自身 `PATH=/usr/bin:/bin` 下
  `/opt/homebrew/bin/node /opt/homebrew/bin/dsh --version` 输出 `0.1.7-rc.2`；
  把 CLI 目录放到 PATH 后 CLI 启动并报
  `error: profile "desktop" is managed exclusively by the Electron application`。
- 本次未做现场验证：原生更新本身需要重启打包宿主，而仓规禁止 agent 重启。服务确实存在的证据
  是已挂载的 `dsh-base` 行、`super(ctx, "pluginManager")` 绑定，以及本包区块所渲染于其中的
  官方插件页——它驱动的正是同一服务。
