# AGENTS.md — dsh-web-all

全家桶聚合载具包：安装它 = 全部功能插件 + 皮肤全家桶一个包装齐。本包无自有插件
逻辑（仅 compat shim），只是 child 插件 insert 行的汇总载体。

## 聚合机制

- `cordis.patch.yml` 是各 child 的 insert 行拼接（含每源注释头）；仓库内子包经
  package.json 的 `workspace:*` 拉入，安装单包即全部就位。
- 已迁出为独立仓库的家族子插件（皮肤中心、宠物、社区插件索引、预设中心）走
  `rows:` 外部行：依赖写成显式 semver 范围，行 `name` 直接是真实包名（不经共享壳
  包装），浏览器半区由卫星自带的 loader entry 挂载、不再内联进本包 bundle。代价
  是这些行没有壳的 fault-isolation；收益是卫星客户端改动不再要求重建本包。
- 家族行的 `name` 是按家族的子路径导出 `@linxin666/dsh-web-all/<family>`（官方
  插件列表因此每行显示独立的 `web-all/<family>` 标题），全部子路径都指向共享
  壳再导出模块 `lib/shells/shell.js`；子路径下必须有扫描器标记 manifest
  （`src/shells/package.json`，构建复制到 `lib/shells/`）：无 `dsh` 声明 +
  `type: module`，阻止 client 模块扫描器的 nearest-package 走查到达包根（否则
  与 compat 行构成同包多来源，扫描器 reconcile 直接抛错）。子路径 exports 键由
  生成器维护，勿手改。
- 包根 `icon.svg` + `package.json` 顶层 `icon` 是官方插件列表的卡片图标（官方
  展示元信息字段，见 [Agent Note](../../.agents/notes/implemented/feature/2026-09-23-family-plugin-icons.md)）；
  家族每个包都带同名素材（独立安装时各自生效），读取方按 `<specifier>/package.json`
  走 exports 表，所以子路径行仍是默认插画。该资源必须留在 npm `files` 白名单内。
- `aggregate.yml` 是唯一手写清单：`patchFrom` 贡献 insert 行（嵌套聚合递归展开、
  按顺序、带源注释），`deps` 解析各子包 name 写入 dependencies（`workspace:*`）。
- `rows:` 段是仓库外的 npm 外部行（单行 JSON flow mapping，`{"id","name"}`）：解析
  从本包 node_modules 出发（`require.resolve('<name>/package.json')`，因此外部包必须
  导出 `./package.json`），渲染在全部 `patchFrom` 行之后。行 id 仍走 `web-ui-*` 命名
  空间，与 `patchFrom` 时期逐字一致；外部包声明 `dsh.bundle.patch` 时展开它自己的
  patch 行（bundle-only 包不能被 loader 直接 import）。
- `tombstones:` 段保留已退役或已迁出子路径的 exports 空壳（指向
  `lib/shells/shell.js`），避免老 profile 残留旧行名时 Node 抛
  ERR_PACKAGE_PATH_NOT_EXPORTED。迁出为独立仓库的 `pet` / `skin-center` /
  `community-plugins` 三个子路径必须留在本清单里。
- `patches:` 段（单行 JSON flow mapping）对本聚合自插入行做整对象 config 覆写：
  用于播种行级默认（如 enabled:false），渲染在全部 insert 之后；
  id 必须是本聚合已存在的行，settings 一经用户改动即优先于播种值。
- `inactive:` 段（行 id 字符串清单）声明出厂默认关闭的自插入行：渲染为尾部
  `disabled: true` 裸覆盖。新装用户该整行不加载、设置入口隐藏（rows 路由门控）；
  用户在插件管理按行开启（写入用户层 disabled:false 覆盖，优先于本默认）。
  锁定的核心行（compat/settings/plugin-manager）禁止列入。
- 宿主半双入口：本包经两个入口 artifact 加载（lib/index.js 走 self 行、
  lib/shells/shell.js 走家族行），构建把共享代码拆成 chunk——每个入口持有自己的
  模块拷贝，任何模块级可变状态都会静默分裂（2026-09-09 事故：路由重复注册告警 +
  rows 路由伺服另一拷贝的空 ledger，门控据此隐藏了全部家族页签）。跨条目/跨拷贝
  的状态一律走 `src/state.ts` 的 globalThis 注册表（Symbol.for 键），禁止模块级
  可变单例。

## 新增 / 改动插件

- 往全家桶加**仓库内**插件，必须同步改 `aggregate.yml`（`patchFrom` + `deps` 各加
  一行）并重跑生成，否则子包不被拉入/不展开。
- 加**仓库外 npm 插件**，改 `rows:`（`{"id","name"}` 一行）**并**手写 package.json 的
  显式 semver 依赖——生成器保留非 `deps` 段的依赖，不会替你写入。
- 生成脚本在仓库根 `scripts/aggregate.mjs`（不在包内），只写本包与它拥有的
  aggregate 缓存，幂等可重跑；`--check` 模式只校验、有漂移退出 1，是 CI 门禁。

## 提交前检查

```sh
node scripts/aggregate.mjs --check
pnpm aggregate:check
```

- 构建顺序：聚合客户端 bundle 内联**仓库内**子插件的 src/client 源码，任何这类
  子插件客户端改动后必须重新构建本包（pnpm --filter @linxin666/dsh-web-all build），
  否则 profile link 安装下宿主代码是新的、页面仍跑旧子插件 UI（2026-09-09
  行级开关"重启后没变化"事故即此原因）。`pnpm dev:watch` 在开发期自动覆盖。
  `rows:` 外部行不内联，卫星自身的客户端改动不需要重建本包。