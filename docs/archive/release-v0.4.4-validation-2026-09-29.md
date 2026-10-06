# v0.4.4 发布验证快照（2026-09-29）

冻结记录：v0.4.4 的实际发布路径、两次红色管线 run 的成因，以及收尾动作。发布流程的当前契约由 [dsh-web-release 技能](../../.agents/skills/dsh-web-release/SKILL.md) 与 [release.yml](../../.github/workflows/release.yml) 拥有，本文件不改写它们。

## 结果

- 本仓 16 个家族包与根别名包发布 `0.4.4`，registry 全部可解析，`@linxin666/dsh-web-all` 的 `dist-tags.latest` 为 `0.4.4`。
- 四个卫星仓（dsh-skins、dsh-pet、dsh-community-plugins、dsh-presets）各自先发布 `0.4.4` 并创建 GitHub Release；本仓随后打 tag。
- tag `v0.4.4` 指向 `aedff8f0d9edca0fb341d5bd06e88db084ad358a`；发布后 `dev`、`main`、`origin/dev`、`origin/main` 同为该提交。
- 双语说明见 [v0.4.4 release notes](../release-notes/v0.4.4.md)。

## 两次红色 run

1. 第一次 run（`36526669092`）在 Tests 阶段失败：`packages/dsh-usage/tests/usage-service.spec.ts` 的「serves the whole-ledger aggregate beyond the 30-day trend window」用 `await sleep(30)` 等待 `start()` 的异步持久化载入，在负载较高（UTC 的 CI runner）时读文件尚未落地，`usage.all.from` 读成当天。该用例自 v0.4.3 起逐字未变，属既有 flake，被本次发布撞上。修复：引入 `waitForPersistedLoad`（`vi.waitFor`，2000 ms 上限），把三处等待载入的用例改为有界等待，提交 `aedff8f0`。测试文件与 v0.4.3 逐字相同即为既有 flake 的证据。
2. 第二次 run（`36527227705`）在 Verify published versions 阶段失败：15 个包在重试窗口内陆续可解析，`@linxin666/dsh-web-all` 始终 HTTP 404，20 次重试耗尽后中止，Mount smoke 与 GitHub Release 因此被跳过。

## npm staging 造成的误判

聚合包实际已上传成功：再次对同一版本执行发布时 registry 回答 `409 Conflict - Cannot publish over previously staged version "0.4.4"`，即 0.4.4 处于 npm 的 staged 状态，尚未对外可解析。该 staged 版本在约 16 分钟后自动转正（实测 05:43Z 上传、05:59Z 可解析），超过了 `scripts/verify-registry.mjs` 当前 20 次重试的窗口，于是验证判定为「未发布」。

登录态与鉴权正常（本机 npm 登录 `linxin666`，工作流用仓库 secret `NPM_TOKEN`），不是凭据问题。

## 收尾动作

发布已经在 npm 侧成立，且不能对该版本重发（版本号不可复用），因此按实际状态收尾：

- 在干净副本（`git archive v0.4.4`）上复核 16/16 与聚合包 `dist-tags.latest`。
- 在干净副本上以钉定的宿主 CLI `@deepseek-ai/dsh@0.2.0-rc.1` 与全新 scratch `DSH_HOME` 运行 `scripts/e2e-mount.sh`：聚合包 tarball 挂载进 scratch profile、`dsh web` 在 OS 分配端口启动、Playwright 无头 lane 1 passed。
- `gh release create v0.4.4 --title "dsh-web v0.4.4" --notes-file docs/release-notes/v0.4.4.md` 创建 GitHub Release（该步骤原本由 verify-release job 承担）。`gh run rerun --job` 无法单独重跑依赖失败的 job，因此手工补齐。

## 后续可考虑

- `verify-registry.mjs` 的重试预算：staged 转正约 16 分钟，当前窗口偏短；或让验证区分「staged 待转正」与「未上传」。
- `pnpm -r publish` 的逐包成功行不是信任边界（脚本自身的注释已经这么写），本次是该判断的又一实例。
- `pnpm test` 中的真实计时等待：`no-arbitrary-sleep` 规则已在 test-standards 中，本次 flake 属该类；基线内的存量等待仍可能在负载下间歇失败。
