# Agent Note: 卫星链接要求检出已安装

Status: implemented

## Problem

0.2.0-rc.1 宿主上的桌面客户端把 skin-center 插件报为引入失败，`@linxin666/dsh-client-ui-skin-center` 的 host 半区无法从 profile 加载：

~~~text
ERR_MODULE_NOT_FOUND: Cannot find package 'jpeg-js'
  imported from /Users/zcl/code/dsh-web/satellites/dsh-skins/lib/index.js
~~~

`scripts/link-profile.mjs` 把 `satellites/` 下的四个卫星仓库链接进 `~/.dsh/profiles/node_modules/@linxin666/`，而它只要看到 `lib/index.js` 就接纳一个检出。这个判据分不清可用检出与从未安装的克隆：卫星仓库把构建产物 `lib/` 一并提交，所以入口文件不能证明被 bundle 外部化的运行时依赖存在。链接因此指向没有 `node_modules` 的检出，加载器到哪里都解析不到 `jpeg-js`（dsh-skins）、`clsx`（dsh-pet）与 `schemastery`（dsh-community-plugins、dsh-presets）。

这是链接缺陷里最糟的一种形态：坏链接不是功能降级，它在宿主启动时直接中断插件导入；而同一个判据也守着聚合包自身的卫星重链，因此 `node scripts/link-profile.mjs` 还可能把聚合包里本来可用的 pnpm store 链接一并搬到同样不可运行的检出上。

## Decision

只有真正可加载的卫星检出才会被链接。`satelliteLoadability(dir)` 在该 `main` 入口存在、且每个运行时依赖都能从检出自身解析时判定可用——这正是该卫星里执行过 `pnpm install` 的状态。

检出不可用时，链接指向聚合包解析到的已安装副本，也就是 `dsh plugin add` 会装下的同一份 registry 产物（依赖齐备）。`decideSatelliteSource(localLoadable, hasInstalled)` 返回 `local`（可用检出，卫星改动因此仍能不经发版抵达 GUI）、`installed`（回退副本），两者都不存在时返回 `skip` 并大声报告。`decideAggregateRelink` 接收同一结论，对不可用检出返回 `skip-report`，聚合包的 pnpm store 链接保持原位。

替换链接的 dry-run 报告现在同时给出新目标与旧目标；此前它只打印当前目标，读起来像是脚本又要装回那个坏链接。

要让本地构建重新生效，只需在该卫星检出里执行 `pnpm install` 并重跑脚本。

## Alternatives considered

**把安装卫星依赖并入本次修复，继续链接本地检出。** 否决作为交付行为：在四个子模块检出里安装，是「就地维护卫星内容」的显式选择，不该由一次 profile 链接刷新替用户决定，而且它会在各自独立发版、把 `lib/` 纳入版本管理的仓库里重建受跟踪产物。

**继续链接该检出，让宿主报错自行暴露。** 否决：该失败会在启动时中断插件导入，而可用提供方就在一层目录之外，且用户看到的「插件引入失败」并不携带缺失依赖的任何信息。

**只在 profile 层回退，聚合包重链不加守卫。** 否决：聚合包重链更强，它会替换一个可用链接。现在两条路径读取同一结论。

**用「`node_modules` 是否存在」代替依赖探测。** 否决：中断或部分裁剪的安装会留下一个什么都解析不到的 `node_modules` 目录，而探测只花四次 `require.resolve`。

## Consequences

- 从未初始化或安装卫星的克隆也能得到可用插件：profile 解析到已安装副本，报告同时点名该检出与缺失的包。
- 卫星链接携带绝对 pnpm store 路径，其后缀会随聚合包重新解析而变化；任何安装之后重跑 `node scripts/link-profile.mjs` 即可修复，而一旦该检出安装完成，脚本会立刻把链接换回本地检出。
- 在有人安装这些检出之前，profile 层不再触及卫星的本地构建，因此卫星开发从在卫星仓库里执行 `pnpm install` 开始——这正是仓库说明里已有的流程。

## Testing

`node --test scripts/link-profile.test.mjs` 21 项测试通过，其中新增用例覆盖：可用检出优先于已安装副本；未安装检出永不顶替 pnpm store 链接；`lib/` 已提交但没有 `node_modules` 的检出报出精确的缺失依赖；入口或清单缺失时如实报告。现场修复执行了 `node scripts/link-profile.mjs`，之后四个卫星的 host 与 client 入口都能从 `~/.dsh/profiles/desktop` 解析并导入（community-plugins 包按设计不暴露 `./client` 子路径）。
