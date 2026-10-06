# v0.4.5 发布验证快照（2026-10-05）

冻结记录：v0.4.5 的实际发布路径、发布后核验结果，以及一次说明校正。发布流程的当前契约由 [dsh-web-release 技能](../../.agents/skills/dsh-web-release/SKILL.md) 与 [release.yml](../../.github/workflows/release.yml) 拥有，本文件不改写它们。

## 结果

- 四个卫星仓（dsh-skins、dsh-pet、dsh-community-plugins、dsh-presets）先各自发布 `0.4.5` 并创建 GitHub Release；本仓随后打 tag。
- 本仓 17 个家族包（16 个公开家族包 + 根别名包 `@linxin666/dsh-web-all`）与根 `version` 发布 `0.4.5`，`scripts/verify-registry.mjs 0.4.5` 首次尝试即全部解析，`dist-tags.latest` 为 `0.4.5`。
- tag `v0.4.5` 为附注 tag（`d637a12e`），指向发布提交 `a6da00a4`；发布后 `dev` / `main` / `origin/dev` / `origin/main` 同为含说明校正的 `1e47ad06`。
- 双语说明见 [v0.4.5 release notes](../release-notes/v0.4.5.md)。发布管线一次通过（run `37282567026`），含 mount smoke 与 GitHub Release。
- 旧聚合包 `@linxin666/dsh-web-ui-all` 的 dual-publish 窗口已关闭，脚本输出 `skip ... transition window complete`；该包保持 `deprecated`，未发布新版本。
- 桌面安装包车道（`desktop-release.yml`）已在本仓移除（`64beab4a`，早于 v0.4.4），v0.4.5 不涉及。

## 说明校正

首次提交的 `docs/release-notes/v0.4.5.md` 在「重要变更」段写成「宿主下限仍为 `>=0.2.0-rc.2`，与 `0.4.4` 一致」，与事实不符：`0.4.4` 声明的是 `>=0.2.0-rc.1`，本版本随官方 cohort 推进把下限提升到 `>=0.2.0-rc.2`（提交 `b1802651`）。

- tag 推送后、npm 发布前发现该错误；发布管线按 tag 指向的树读取 `docs/release-notes/v0.4.5.md`，已无法在本次 run 内替换。
- 处置：修正文件后以 `1e47ad06` 提交到 `dev` 并快进 `main`（不移动、不重推 tag），再用 `gh release edit v0.4.5 --notes-file docs/release-notes/v0.4.5.md` 校正已创建的 GitHub Release。
- 已复核 Release 正文改为「下限提升到 `>=0.2.0-rc.2`、`0.4.4` 为 `>=0.2.0-rc.1`」且 `user-mention` 计数为 0。

## 后续可考虑

- 发布说明里的「下限/cohort」类事实应与 `packages/dsh-web-all/package.json` 的 `dsh.engines.dsh` 逐条核对后再提交；本仓的 cohort 移动提交（`b1802651`）修改了下限但未同步 release-notes 模板提示。
- 发版提交后、推送 tag 前增加一次「说明与 `engines.dsh` 一致性」自检，可避免发布后只能靠 `gh release edit` 校正。
