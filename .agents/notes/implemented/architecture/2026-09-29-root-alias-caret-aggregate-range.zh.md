# Agent Note: 根别名以 caret 范围跟随发布线依赖聚合包

Status: implemented

## Problem

仓库根是薄别名 bundle：它的 patch 是聚合包生成的 `web-ui-*` 清单，而这些行引入的每个模块都由 `@linxin666/dsh-web-all` 依赖解析（见[别名记录](../feature/2026-08-30-repo-root-installable-alias.md)）。这条依赖规格因此是“补丁”与“已导出子路径集合”之间的兼容契约，issue #1442 正是它漂移的代价：根当时声明 `^0.3.6`，git ref 移到一个按家族子路径挂载行的补丁，lockfile 保留了更旧的子包（报告里是 0.3.10），于是每一行都报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，loader 进入恢复模式。

第一次修复把依赖钉成一个精确的已发布版本（`0.3.20`）：没有范围，旧子包就不可能满足它。代价是根清单里多了一个只有发布门禁记得去搬的字面量，而且发布线出了更新的补丁之后，仓库根仍停在单个补丁版本上。

## Decision

- 根 `package.json` 声明 `"@linxin666/dsh-web-all": "^X.Y.Z"`，`X.Y.Z` 即发布 tag：以“生成本提交补丁的那一版发布”为基线的发布线 caret 范围。
- `scripts/lib/root-alias-pin.mjs` 的 `rootAggregatePinMismatch` 断言规格恰好等于该形态，`scripts/verify-version.mjs` 在发布前运行它：基线不得落后于 tag，精确钉版、`~`、`>=`、`*` 都不能通过发布。
- 发版时基线随 tag 一起搬：[dsh-web-release](../../../skills/dsh-web-release/SKILL.md) 第 1 步同时重写根的 `version` 与该依赖，并刷新锁文件的 specifier。

caret 仍能封住 #1442，是因为基线就是 tag：每次家族发版都会改变 spec 字符串，上一版发布留下的 lockfile 因此不再满足它而重新解析。#1442 证明不安全的是“基线停在已发补丁之后的范围”，不是范围本身。

## Alternatives considered

- **保留精确钉版**（被取代的 2026-09-10 决定，commit `058c981c`）。否决：它把版本写死在清单里，只能靠发布门禁记得同步，而且发布线一出新补丁，根就脱离发布线。真正需要的不变量是“基线等于 tag”，caret 把它表达得更直接。
- **保留宽范围、加运行时守卫**，在解析出的聚合包缺少子路径时提前报错。否决：只是把启动失败提前成另一种启动失败，lockfile 仍会解析出不兼容的子包。
- **静态下限 `>=0.3.19`**（当时第一个导出全部行的版本）。否决：今天能强制重新解析，但之后家族一旦新增子路径就会静默漂移——本 Bug 正是这样出现的。
- **把构建好的聚合包放进根 git 载荷**。否决：违背别名设计（薄清单 + 模块来自 npm），并会在用户机器或 git 里重复发布构建。
- **根不声明该依赖，改由 profile 自行安装聚合包**。否决：那样各行引用的模块在 profile 里没有安装来源；要求用户额外安装聚合包又回到别名记录已经写明的“别名与聚合包重复 row 冲突”。

## Consequences

- 发版会移动范围基线，根因此在发布线内跟随补丁，同时补丁与模块仍来自同一版发布（npm 渠道滞后除外）。
- 全新安装（没有上一版的 lockfile 条目）解析到发布线内最新的聚合包，而非 tag 自身那一份构建。家族行只增不减，被移除的子路径在聚合包 exports 表里以 `tombstones:` 保留（见[卫星仓记录](2026-09-23-family-satellite-repositories.md)），所以同线内更新的聚合包仍导出较旧补丁挂载的每一行；需要防的是相反方向（更旧的聚合包），那正是 verify-version 现在挡住的情况。
- 忘记搬基线仍是发布失败，而不是用户可见的启动失败：`verify-version` 注解 `package.json` 并以退出码 1 结束。
- 别名记录里的 npm 渠道滞后仍然成立：git 安装某个 commit 时，若其 patch 引用了尚未发布的成员，要等那一版发布后才能解析。

## Testing

- `node scripts/verify-version.mjs 0.4.4` 输出 `[verify-version] all 16 packages, the root version and the root aggregate caret ^0.4.4 match v0.4.4`；对 `0.4.5` 运行同一命令退出码 1，并注解 `package.json`：`root dependency @linxin666/dsh-web-all ^0.4.4 does not match tag v0.4.5 (expected ^0.4.5)`。
- `node --test scripts/root-alias-pin.test.mjs`：接受 tag `0.3.20` 上的 `^0.3.20`，拒绝精确钉版 `0.3.20`、基线落后的 `^0.3.19`、旧宽范围 `^0.3.6`、`~0.3.20`、`>=0.3.20`、`*` 与缺失依赖。
- `pnpm install --lockfile-only --ignore-scripts` 只改锁文件一行（`specifier: ^0.4.4`，仍是 `version: link:packages/dsh-web-all`），checkout 内的 workspace 链接行为不变。
