# Agent Note: remote-web-ui 局域网绑定落在实际启动的 profile

状态：已实现 (implemented)

## 问题背景

局域网访问开关把受管 webserver 块写入 `<profile>/cordis.patch.yml`，而"哪个
profile"取自 `config.profile ?? process.env.DSH_PROFILE ?? 'web'`。`dsh` CLI
会导出 `DSH_PROFILE`，所以 `dsh web` 部署一直正常。DSH 桌面客户端不会：它以
`runProfile({ profile: 'desktop', args: ['--no-open', '--port', '19387'] })`
启动 `desktop` profile，从不设置该环境变量，于是插件解析出 `web`，把受管块写进
`$DSH_HOME/profiles/web/cordis.patch.yml`，而运行中的宿主读的是
`profiles/desktop`。

用户可见症状：在桌面客户端设置卡片里打开「局域网访问」后，局域网始终访问不到
GUI。卡片一直提示需要重启，运行中的绑定仍是 `127.0.0.1`，面板持续显示
"此功能需要局域网绑定或公网地址才能使用"，手机一直进不来。

官方运行时把实际启动的 profile 发布在宿主上下文的 `profileContext` 服务上
（`{ name, dir, patchPath, installAnchor, … }`）：它正是
`@deepseek-ai/dsh-base` 用来分支的服务（`ctx.get('profileContext')?.name === 'desktop'`），
也是 `@deepseek-ai/dsh-shell-env` 填 `DSH_PROFILE` 的来源。`dsh-desktop-host`
以 `name: "desktop"` 提供它。

## 技术决策

- `lan-bind-plan.ts` 新增纯函数 `resolveManagedProfile(configured, launched, env)`
  统一优先级：显式 `profile` 配置 → 宿主发布的实际启动 profile → `DSH_PROFILE`
  → `web`。写成纯函数，使启动路径与设置/状态路径共用一份实现，并由单测钉住顺序。
- `index.ts` 每次激活读取一次运行时事实（`launchedProfileName(ctx)`），喂给解析后
  的配置。
- 桌面客户端因此管理 `profiles/desktop/cordis.patch.yml`——它真正读取的那份文件。
  CLI 与容器部署行为不变：没有发布该服务时仍由环境变量决定。

## 备选方案

- **让桌面客户端导出 `DSH_PROFILE`**：否决——那是本仓库无权修改的官方启动器，
  而运行时服务本身已为所有宿主形态携带该事实。
- **要求用户自己填 `profile` 字段**：否决——该字段是覆盖项，默认值必须对常见情形
  正确。
- **改用 `profileContext.patchPath` 定位补丁文件**：暂不采用——基于 profile 名的
  路径构造器已有目录包含性守卫与测试，改用服务路径改动更大，而在解析器自己的 home
  已是事实源的前提下没有行为收益。

## 影响与后果

- 桌面用户打开局域网访问后，绑定会在下次启动生效；`pendingRestart` 在该次启动后
  清除，而不会永久挂着。
- 中继身份按 profile 存储（`$DSH_HOME/remote-web-ui-registry/<profile>.json`），
  桌面客户端不再与 `web` profile 共用同一注册源。
- 手写的用户补丁行会**整对象替换**该行的 `config`：要设置 `lanBind: true` 的行
  必须同时重申聚合壳的 `plugin: '@linxin666/dsh-remote-web-ui'`，否则家族壳没有
  导入目标、该行降级（设置卡片写入的是完整 config，界面内编辑不受影响）。

## 测试

- `tests/lan-bind-plan.spec.ts`：显式配置优先于实际启动 profile 与环境变量；实际
  启动 profile 优先于过期的 `DSH_PROFILE`（桌面场景）；其余回退为环境变量，最后
  为 `web`。
- 现场证据：修复前，绑定在 `127.0.0.1:19387` 的桌面宿主对
  `GET /api/pair/lan-bind` 返回 `"profile":"web"`；读取实际启动 profile 后同一
  端点返回 `desktop`。
