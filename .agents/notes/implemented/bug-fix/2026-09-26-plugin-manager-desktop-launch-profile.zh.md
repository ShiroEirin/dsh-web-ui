# Agent Note: plugin-manager 网关按桌面端启动事实解析 profile

Status: implemented

## Problem

桌面端（打包的 Desktop 客户端）插件页点击「检查更新」时固定失败，报
`plugin-manager: gateway api/plugin-manager/check-updates failed: HTTP 404`。

浏览器半区此时走的是网关通道（桌面宿主并不通过 HTTP 暴露官方
`/plugin-installer` RPC 通道，实测为 404），因此调用的是本包自己的 loopback 网关
`/api/plugin-manager/check-updates`——而那个路径上什么都没有。对运行中的宿主
（绑定 `127.0.0.1:19387`）实测：带鉴权 Cookie 的 `GET /api/dsh-web-all/rows`
返回 200 且包含 `@linxin666/dsh-client-ui-plugin-manager` 这一家族行，同族其它
宿由路由同样 200，而所有 `/api/plugin-manager/*` 一律 `404 not found`。也就是
宿主半区在注册任何路由之前就返回了。

根因：`resolveProfile()` 只从 `--profile`、`DSH_PROFILE`、`web` 子命令和
打包应用持久化的选择里解析启动 profile。而桌面启动器是通过
`runProfile({ profile: 'desktop' })` 启动的，上述四个来源一个都没有：其 argv 为
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
<profileDir>, …]`，且没有导出 `DSH_PROFILE`（两者均以 `ps eww` 核实）。
`resolveProfile()` 抛出 `plugin-manager: cannot determine the boot profile`，
`applyImpl` 记录后返回，于是网关在整个进程生命周期内都没挂上，而家族行仍在渲染
更新区块。

## Decision

官方运行时在宿主上下文发布的启动 profile —— `profileContext`
（`{ name, dir, patchPath, installAnchor, … }`）—— 就是网关的解析事实来源，与
[remote-web-ui 的局域网绑定](../2026-09-25-remote-web-ui-desktop-lan-bind-profile.md)
此前的处理完全一致：

- `src/host/profile.ts` 的 `resolveProfile(argv, env, launched?, desktopLauncher?)`
  接收启动事实，优先级为：显式 `--profile`、已发布的 profile、启动器 argv 中位置携带
  的 profile 目录、`DSH_PROFILE`、`web` 子命令、桌面端持久化选择，最后才是明确的
  抛错。argv 事实之所以存在，是因为 Electron 会从 `process.argv` 剥掉 exec 开关：
  桌面宿主的 argv 形如 `[execPath, dsh-desktop-host/lib/index.js, <dsh>,
  <profileDir>, …]`，并把这个位置参数原样交给自己的 profile 加载器。它是独立于
  服务的启动器事实，因此未发布 `profileContext` 的运行时同样能挂上网关而不是 404。
  启动事实优先于 `DSH_PROFILE`，是因为在本运行时里该变量是**输出**而非启动选择器：
  `runProfile()` 是 CLI 与桌面端共同的唯一启动路径，两者都会提供 `profileContext`；
  而 `@deepseek-ai/dsh-shell-env` 正是**从** `profileContext.name` 派生出
  `DSH_PROFILE` 供其子 shell 使用，运行时没有任何模块读它来选择 profile。两者同时
  存在时指向同一 profile，而服务携带更精确的事实（确切的目录与 patch 文件）；顺序
  唯一起作用的场景是变量过期或被人为设置、与运行中宿主不一致——照它走会挂上一个
  写不进宿主实际读取文件的网关（即
  [remote-web-ui 的 note](../2026-09-25-remote-web-ui-desktop-lan-bind-profile.md)
  记录的失效形态）。已发布的 `dir`
  用作 profile 根目录——它正是运行时交给自身 profile 加载器的同一个目录——因此
  网关读写的就是运行中宿主使用的那批文件，而不是按 `DSH_HOME` 重新拼一条路径。
  仅有名称的服务仍回退到 `$DSH_HOME/profiles/<name>`。
- 已发布事实按**外来输入**校验而非直接信任（尽管它来自官方运行时）。`name` 驱动
  每一次 `dsh plugin --profile <name>` 派生，必须是恰好一个目录分段：分隔符、`..`、
  `.` 与空串均拒绝（`.` 尤其重要——`join` 会把它归一化掉，从而解析到 `profiles`
  目录本身）。`dir` 是全部读取与覆盖行写入的根，必须是绝对路径、**原始**分段中
  不含 `..`，且其 basename 与已发布名称一致，以免文件系统半区与 CLI 半区指向不同
  profile。已发布的 `patchPath` 是写入目标，只有等于 `<dir>/cordis.patch.yml` 时
  才被接受，否则由该目录推导。
- 解析器的守卫约束的是名称/目录的**形状**，而非位置**范围**：本 DSH home 之外的
  绝对目录在解析阶段仍会被接受。真正起作用的范围检查是 `src/index.ts` 的挂载门禁
  ——已解析目录必须含 `package.json` 才会注册任何路由，因此没有初始化 profile 的
  外来位置保持休眠。
- `src/index.ts` 以可选的 `ctx.get('profileContext')` 读取该服务（不新增注入依赖，
  与 `@linxin666/dsh-remote-web-ui` 同形），宿主未发布任何事实时回退到 argv 与
  环境变量。
- `isPackagedDesktopArgv(argv)` 在 argv 指向 `@deepseek-ai/dsh-desktop-host`
  入口脚本时把本次运行标记为 desktop——严格按启动器事实：仅仅**名称**叫
  `desktop` 的 profile 不足以说明宿主形态，因此不再由名称推断。这样打包应用里的 `/mode` 仍返回
  `{ official: null }`（该宿主把安装服务注册在进程内，CLI 启动转储看不到），
  浏览器半区据此先做直接能力探测再回退到网关。CLI 与容器 profile 行为不变：
  没有已发布服务时由 argv 与环境决定，`desktop` 保持 false。

双通道划分、路由表、wire 形状与 loopback 门禁均未改动；`LaunchedProfile` 是契约
观察而非 import，与本包既有的官方安装器 wire 形状镜像一致。

## Alternatives considered

- **让桌面启动器传 `--profile` 或导出 `DSH_PROFILE`。** 拒绝：该启动器是本仓库
  之外的官方组件，而运行时已经为所有宿主形态发布了已解析的 profile。
- **让 `DSH_PROFILE` 优先于启动事实**（最初任务描述假定的顺序）。据实证拒绝：本
  运行时里该变量不是启动选择器。`runProfile()` 对 CLI 宿主同样提供
  `profileContext`，`@deepseek-ai/dsh-shell-env` 是**用** `profileContext.name`
  写出 `DSH_PROFILE` 的，且对打包运行时的扫描显示没有任何模块读它来选择 profile。
  因此优先它在一台自洽的宿主上永远不会选出不同 profile，而在不自洽的宿主上会把网关
  ——以及启停覆盖行的写入——挂到运行中宿主根本不读的 profile 上。`--profile` 仍是
  两者之上的运维覆盖，且当既无服务也无启动器事实时，变量保留完整的回退作用。
- **在已发布服务之前回退到桌面端持久化选择
  (`desktopSelectedProfile()`)。** 拒绝：该函数读的是
  `<appData>/DSH Desktop/profile-selection/state.json`，与运行中宿主的答复并非
  同一来源，且本机这个位置根本没有该文件（已核实打包应用的 user-data 目录下没有
  `profile-selection`）。已发布服务描述的是正在运行的 profile，而不是对它的猜测。
- **把 profile 名称做成插件配置项。** 拒绝：这会把启动器事实推给用户，而一旦填错
  就会静默改写并非运行中的 profile —— 正是 remote-web-ui note 记录过的失效形态。
- **保留按名称拼路径，只从服务取名称。** 拒绝：已发布的 `dir` 就是启动 profile
  自身的事实（运行时把同一个目录交给它自己的 profile 加载器），而网关的写入与
  CLI 的 `--profile` 参数必须落在运行中宿主读取的 profile 上。服务不发布目录时
  仍保留按名称回退。
- **直接按原值使用已发布的 `patchPath`。** 拒绝：它是写入目标，外来取值会让网关
  的覆盖行写入逃出它挂载的 profile。patch 路径改由已校验的目录推导，发布值与之一
  不一致时大声拒绝而不是静默忽略。
- **把名为 `desktop` 的 profile 当作桌面宿主。** 拒绝：名称不足以说明宿主形态，
  而标记为 desktop 会挂起 `/mode` 真正的安装服务探测——仅仅用了这个名字的 CLI
  宿主会因此被误判。只有启动器事实（或桌面端持久化选择）才做此标记。

## Consequences

- 打包的桌面端现在会挂上完整网关路由表（`list`、`install`、`update`、
  `remove`、`status`、`set-enabled`、`failures`、`mode`、
  `check-updates`），已安装插件页面上的更新区块因此能真正访问 registry，而不是
  报 404。
- 桌面端上 `facts.profileDir` 现在来自宿主自己的启动事实，因此即使应用持久化
  选择缺失或指向别的 profile，启停写入与 CLI 探测也仍然针对 `profiles/desktop`；
  `facts.patchPath` 始终是该目录自己的 `cordis.patch.yml`。
- 既不发布 `profileContext` 又没有任何启动器事实的宿主仍然保持休眠，不会挂到
  猜测的 profile 上：把网关挂到错误的 profile 会去改运行中宿主根本不读的文件。
- 该改动在宿主下次启动时生效 —— 宿主半区是启动时加载一次的构建产物
  `lib/index.js` —— 因此打包应用需要重启后桌面端才会生效。

## Testing

- `tests/desktop-launch-profile.spec.ts` 钉住解析：桌面 argv 加已发布服务时全部
  事实取自该服务；仅有名称时按平台布局重建；没有任何已发布事实时环境变量仍指明
  profile；已发布 profile 在任意宿主上都优先于过期的 `DSH_PROFILE`；仅仅名为
  `desktop` 不会把运行标记为 desktop；普通 argv 且既无发布也无变量时仍然抛错；
  已发布的穿越名称被拒；已发布目录为相对路径或含 `..` 时被拒；已发布 patch 路径
  不等于该 profile 自己的 `cordis.patch.yml` 时被拒。
- `tests/host-apply-desktop.spec.ts` 是这次 404 的回归测试：它以桌面 argv 驱动
  真实的 `apply()`，上下文提供 `webServer` 与 `profileContext`，断言九条网关
  路由全部注册；并断言没有任何启动器事实或 profile 未初始化时半区保持休眠。
- 构建产物实测：用运行中宿主抓取的 argv 与其已发布 profile 事实驱动
  `lib/index.js`，九条路由全部注册；`GET /api/plugin-manager/check-updates`
  返回 200 并带两条真实待更新项（`@eddyskywalker/dsh-chatgpt-subscription`
  0.8.2 到 0.8.5、`dsh-llm-verifier` 0.8.4 到 0.8.6），
  `/api/plugin-manager/mode` 返回 `{"official":null}`。