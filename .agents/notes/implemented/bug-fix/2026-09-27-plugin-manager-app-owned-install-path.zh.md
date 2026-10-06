# Agent Note: 应用自有 profile 上的插件管理器安装与卸载

Status: implemented

## Problem

在打包桌面客户端（DeepSeek Harness Electron 应用，profile 为 `desktop`）上，
从创意工坊商店一键安装社区插件会失败：
`安装失败：error: profile "desktop" is managed exclusively by the Electron application`。

来自运行中宿主的现场证据（pid 63705，argv 为
`[Electron, --expose-internals, …/dsh-desktop-host/lib/index.js, …/dsh,
/Users/zcl/.dsh/profiles/desktop, …/primary-runtime, …/pnpm.mjs, …/bin]`）：

- `GET /api/plugin-manager/mode` 返回 `{"official":null}`：desktop 事实成立，
  浏览器半区因此回落到本包的 loopback 网关——桌面宿主并不发布官方
  `/plugin-installer` RPC 通道。
- 商店卡片调用 `pluginManager` cordis 服务的 `install(spec)`，经
  `POST /api/plugin-manager/install` 到达 `CliGateway.install()`；而该方法
  spawn 的是 `dsh plugin --profile desktop add <spec>`，官方启动器的
  `rejectElectronProfile()` 会在 pnpm 启动前直接拒绝。
- `CliGateway.update()` 早已把应用自有 profile 路由到官方进程内管理器
  （见[更新路径的决策记录](2026-09-26-plugin-manager-app-owned-update-path.md)），
  而安装与卸载仍无条件走 CLI。

## Decision

`CliGateway.install()` 与 `CliGateway.remove()` 采用与 `update()` 相同的写入器
选择：当 `facts.desktop` 为真且宿主在 `pluginManager` 服务上发布了官方进程内
管理器时，任务改走 `installBundle(spec, { enabled: true, requestId })` /
`removeBundle(name)`，不再 spawn CLI。`NativePluginManager` 契约观察新增
`removeBundle(name)`（始终是契约观察，不是 import）。

校验与 CLI 路径一致，因为「管理器返回成功」并不等于 profile 发生了变化：只有当
profile 新增了一条此前没有的依赖时安装才算 `done`，只有当原本存在的依赖消失时
卸载才算 `done`。管理器解析成功却没改动 profile 时是 `安装未生效` /
`卸载未生效`；被拒绝的运行同样会解析成功——管理器的 `change()` 包装器把它折叠进
返回的判定（`application: 'failed'` / `'cancelled'`、`error.code`、
`error.diagnostic`）——因此 `nativeManagerFailure()` 先读该判定并按其自身原因
上报（`官方插件管理器安装失败：…` / `卸载失败：…`，含 pnpm 诊断），随后才做
profile 校验，与更新路径一致。任务表、`/status` 轮询、变更队列与浏览器半区的
wire 契约均不变，因此创意工坊商店与「检查更新」区块无法区分两条写入路径。

既然该处 CLI 不是写入器，网关的 HTTP 安装、更新与卸载路由会先问清本次请求由哪个
写入器服务（`CliGateway.usesNativeWriter()`），只有确实要跑 CLI 时才要求 `dsh`
二进制：在 PATH 里没有 `dsh` 的打包桌面宿主上，旧守卫会在官方管理器还没被问之前就
回 500 `dsh CLI not found on PATH`。宿主持有应用自有 profile 却没挂载官方管理器时，
仍然以同样的 500 失败关闭。

CLI 专属的守卫（重复挂载剥离、insert 行解析、`--dump-config` 预检、经 CLI
remove 的回滚）仍留在 CLI 写入器一侧：它们补偿的是 CLI 的 bundle 归并行为，而官方
管理器会自行校验并应用 bundle——这正是更新路径已经记录过的分工。在包括 npm 发布的
web 运行时在内的所有其他运行时上，安装、更新与卸载仍以 CLI 为唯一写入器。

## Alternatives considered

- **只修商店卡片。** 卡片本来就是把安装交给 `pluginManager` 服务，拒绝来自它路由到
  的宿主写入器；客户端改动要么重复官方管理器的工作，要么把同样的拒绝留给该服务的
  其他消费方。
- **让桌面宿主发布官方 `/plugin-installer` RPC 通道。** 启动器与宿主都是本仓库之外
  的官方组件，而且网关必须能在完全不发布通道的宿主上工作。
- **任何运行时只要挂载了官方管理器就走它。** 已在[更新路径的决策记录](2026-09-26-plugin-manager-app-owned-update-path.md)
  中被否决：npm web 运行时正是靠 CLI 路径承载归并守卫。只有 CLI 完全拒绝写入的应用
  自有 profile 才走原生写入器。
- **应用自有 profile 由网关直接调用 pnpm。** 理由同前：会重复官方管理器的 registry
  规划、锁、bundle 激活与构建脚本审批。

## Consequences

- 创意工坊商店的一键安装，以及所有通过 `pluginManager.install()` /
  `uninstall()` 消费该服务的家族插件，都能在打包桌面客户端上工作：任务以
  `done` 和已安装行返回，下次宿主启动即加载该插件。
- 原生安装/卸载路径不运行网关自身的守卫；该路径下由官方管理器负责校验、pnpm 调用、
  profile 锁与 bundle 激活，网关之后重新读取 profile 复核。
- 旧聚合包迁移仍只走 CLI，因此依旧会在应用自有 profile 上撞到启动器拒绝。它是针对
  `@linxin666/dsh-web-ui-all` 的定向修复，其多步流程（CLI 归并守卫、bundles 重排、
  dump-config 预检、回滚）目前在桌面场景下没有证据支撑。
- 该改动在下次宿主启动时生效：host 半区是启动时加载的构建产物 `lib/index.js`。
- 创意工坊商店已不再把安装路由到本网关：它改为调用官方管理器自己的 remote 面，并把管理
  交给官方插件页（见[复用记录](../architecture/2026-09-27-workshop-store-reuses-official-plugin-surfaces.md)）。
  本条网关路径保留为家族消费方与"宿主未发布 remote"时的回退。

## Testing

- `tests/native-writer-route.spec.ts`：在挂载了官方管理器、且不暴露 CLI 的应用自有
  profile 上，安装、更新与卸载路由都返回 200 与 jobId；在普通 profile、以及没挂载
  管理器的 desktop profile 上，仍保持 500 `dsh CLI not found on PATH`。
- `tests/gateway-jobs.spec.ts`：desktop 事实下安装走脚本化的官方管理器，CLI spawn
  接缝一旦被使用即抛错；管理器失败时任务以管理器消息报错；安装或卸载的折叠式失败判定按
  自身原因上报，而不是 `安装未生效` / `卸载未生效` 这类空转文案；管理器返回成功却没新增
  依赖时报 `安装未生效`；卸载走 `removeBundle` 且依赖确实离开 profile；管理器返回成功
  却没删除依赖时报 `卸载未生效`；非 desktop profile 上安装与卸载仍以 CLI 为写入器、
  管理器完全不被触碰。上一份记录中的原生更新测试继续通过。
- 该修复路由到的写入器在运行中的 profile 里已获真机验证：官方管理器把操作日志写在
  `~/.dsh/profiles/desktop/.plugin-manager/logs/` 下，日志显示它确实在进程内写这个
  profile——`operation-rXQHkp/pnpm.log`（2026-09-27）新增了
  `dsh-better-sidebar ^0.21.1`，`operation-uy6dkO`（2026-09-24）新增了
  `dsh-web link:/Users/zcl/code/dsh-web`，`operation-pA7jAh` 新增了
  `dsh-llm-verifier`。也就是说，这条路径在 CLI 被拒绝的地方已被证明可用；尚未验证的
  只是本网关自己对它的调用，而这需要重启打包宿主——仓库禁止 agent 重启。
  对同一台宿主做的现场探测也确认了本修复要覆盖的通道缺口：`GET`
  `/plugin-installer` 与 `/plugin-control` 返回 404（`POST` 返回的 405 是 web
  server 对未知路径的通用应答——`/zzz-nope` 同样返回 405），因此浏览器半区没有可回落
  的官方 HTTP 通道，网关就是它的写入路径。
