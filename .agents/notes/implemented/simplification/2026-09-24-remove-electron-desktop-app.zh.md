# Agent Note: 移除本仓库的 Electron 桌面应用

Status: implemented

## Problem

本仓库曾自带一个 Electron 桌面应用：顶层 `desktop/` 工程把内置 Node 运行时、dsh 宿主与预装 `web` profile 交给 `.github/workflows/desktop-release.yml`，在每次版本 tag 上打成 `dsh-desktop-*` 资产，并自带 Windows CI lane、单元测试 lane、运行时 seed 引脚与 README 下载说明。

DeepSeek Harness 现在有官方桌面客户端。桌面体验归它所有：它用自己的交付协议提供 Web GUI，在 `$DSH_HOME/profiles/desktop` 下维护自己的 profile，并像任何 DSH 安装一样从 npm 拉取家族包。第二个由本仓库自有的桌面发行版重复了打包 lane、运行时载荷、cohort 引脚与文档面，却没有提供官方客户端不具备的能力；其安装包是未签名的本机分发构建，运行时载荷每次 cohort 升级都要手工重钉。

## Decision

本仓库不再发行桌面应用。整棵 `desktop/` 树及其打包 workflow 被删除，只服务于构建、测试、播种或宣传它的一切 lane、脚本、引脚与文档一并移除：

- `desktop/`（应用、测试、运行时 seed、安装器配置）与 `.github/workflows/desktop-release.yml` 删除。
- `ci.yml` 去掉 `pnpm test:desktop` 步骤与 `desktop-windows` job；根 `package.json` 去掉 `test:desktop` 脚本；`scripts/test-standards.mjs` 不再把 `desktop/` 当作业务 lane，测试基线去掉三个桌面测试文件；`scripts/rollout-verify.test.mjs` 去掉内置宿主的 seed 引脚断言。
- 根 README 双语把 DSH Desktop 下载章节换成官方桌面客户端：客户端与 `dsh web` 共用 `~/.dsh`，用同样的 `dsh plugin` 命令把家族包装进它自己的 `desktop` profile。
- `packages/AGENTS.md` 在「桌面启动器已移除」例外中把桌面面归给官方桌面客户端。

没有任何随包发布的插件代码发生变化：`packages/` 下没有一处 import 该应用，而[远程访问的页面本机判定](2026-09-21-remote-one-time-landing-grant.zh.md)对桌面交付协议的处理，正是家族在官方客户端内正确工作的原因。

## Alternatives considered

**保留应用，只是不再打包进 Release。** 仅供开发的 Electron 外壳依旧要在每次 cohort 升级时维护运行时载荷、seed 引脚与测试 lane，README 还得解释为什么下载链接没了而目录还在。被移除的正是维护成本，而不是 Release 挂载本身，这个方案几乎把它全留下。

**只删 `desktop-release.yml`。** 应用会留在树里且没有构建路径：它的 lockfile 继续解析着被钉住的宿主 cohort，Windows 专属辅助代码继续占着测试 lane，读者只能从缺失的 workflow 里推断产品已退役。删一半读起来像坏了，而不像决策。

**为桌面辅助代码保留 Windows CI lane。** 该 lane 只为 Electron 辅助代码编码的 win32 语义（Path/PATH 归一、NTFS junction、Windows 临时目录布局）存在。辅助代码没了，这条 lane 不断言任何东西；一个不测任何随包代码的绿灯 job 比没有 job 更糟。

**把应用的能力移植进官方客户端。** 官方客户端拥有自己的外壳、profile 布局与发布通道，插件无法为它发布安装包。家族对桌面的真实贡献是插件全家桶，官方客户端通过普通 profile 机制即可安装。

## Consequences

Releases 页不再收到 `dsh-desktop-*` 资产，本仓库的桌面面就是官方 DeepSeek Harness 桌面客户端。桌面用户用 `dsh plugin --profile desktop add @linxin666/dsh-web-all@latest` 安装家族包；`dsh web` 用户不受影响。

`scripts/rollout-verify.test.mjs` 所守的运行时 seed 新鲜度不变式只对内置载荷成立；根 lockfile 检查与 scaffold floor 检查保留。Windows runner lane 随它覆盖的辅助代码一起离开 CI，因此没有任何随包代码失去执行证据——被删的 lane 断言的正是被删的代码。

此处列出的桌面归属笔记记录的是已不存在的机制：[Electron 桌面版笔记](../architecture/2026-09-03-electron-desktop-app.zh.md)、[打包 workflow 笔记](../process/2026-09-04-desktop-release-packaging-workflow.zh.md)、[Windows CI lane 笔记](../testing/2026-09-06-windows-ci-lanes-for-desktop.zh.md)与[运行时 seed 笔记](../simplification/2026-09-04-desktop-runtime-seed-0.3.14.zh.md)标记为被取代，[根 README 笔记](../process/2026-09-10-root-readme-feature-focus-and-desktop.zh.md)在其描述该应用章节之处作事实修正。

验证：`pnpm test:scripts`、`pnpm test:standards`、`pnpm docs:check`、`pnpm typecheck` 与 `pnpm test`。不涉及 `dsh web` 重启——没有 bundle、patch 行或运行时源码变更。
