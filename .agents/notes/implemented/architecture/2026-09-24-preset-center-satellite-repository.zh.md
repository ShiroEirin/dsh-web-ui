# Agent Note: 预设中心迁往 dsh-presets 仓

Status: implemented

## 问题

预设中心是本仓最后接受外部贡献的内容类别，它承担着[家族卫星拆分](2026-09-23-family-satellite-repositories.md)已经从皮肤中心、宠物插件与社区插件索引上移除的三项代价（背景见[创意工坊接受 agent 预设贡献 PR](../process/2026-09-09-workshop-accepts-agent-preset-prs.md)）。

预设是内容：`presets/<id>/` 下的一个目录加 `catalog.json` 里的一条登记，由市场构建读取、经 dsh-market.com 分发。增加一个预设意味着 fork 一个装有十六个插件包的单仓，而且它的评审走的是通用的家族插件路由，不是内容路由。目录只能搭家族发布的顺风车，而先迁走的三类内容仅凭市场钉扎就能到达用户。PR 门禁还必须为预设留一个例外，于是「本仓不接受外部 PR」这句话根本无法成立。

## 决策

预设中心在 [dsh-presets](https://github.com/zhu1090093659/dsh-presets) 仓维护，本仓按消费三个兄弟仓的同一方式消费它。

- **插件是已发布 npm 包。** 聚合包手写依赖 `@linxin666/dsh-client-ui-preset-center: ^0.4.1`，并以外部 `rows:` 行（`web-ui-preset-center`）挂载；`./preset-center` 作为兼容 tombstone 留在聚合包 exports 里。registry 上已有的 0.4.1 就是这批源码拆分前的构建，因此聚合包无需等卫星发版即可切换。
- **目录是按提交钉扎的市场输入。** `market-inputs.lock.json` 增加第四份输入（`satellites/dsh-presets`、内容目录 `presets`、目标 `presets`），仓库在 `.gitmodules` 里增加对应 submodule，`scripts/market-build` 读取 `.market-inputs/presets` 的方式与读取皮肤、宠物、社区索引完全一致。仓内回落路径按前三个的既有做法保留，供夹具脚本测试使用。
- **卫星仓自持整条车道。** dsh-presets 自带 CI（目录门禁、脚本测试、typecheck、测试、构建，以及对已提交 `lib/` 的重建比对）、发布工作流、PR 路由，以及由 `presets/README.md` 派生的投稿清单。`scripts/preset-catalog.cjs` 复述市场构建对目录执行的那些不变量，让贡献者在钉扎前移之前就发现坏投稿。
- **PR 门禁不再保留任何例外。** `reject-non-content-pr.yml` 把勾选「新预设收录」的 PR 与另外三类内容一样重定向到 dsh-presets；PR 模板、[CONTRIBUTING.md](../../../../CONTRIBUTING.md)、[PR_TRIAGE.md](../../../../PR_TRIAGE.md) 与 [ISSUE_TRIAGE.md](../../../../ISSUE_TRIAGE.md) 现在都写明本仓不再直接接受外部贡献。

## 备选方案

**只搬插件、目录留在本仓。** 否决：两者共享同一份发布契约——插件的库路径、provenance 格式与 catalog schema 都是对着同一批 `presets/` 字节读的——而且先迁的三个卫星仓都把插件与它的内容放在同一个仓库里。把它们拆开，等于把预设的校验放到发布它的仓库之外。

**目录留在本仓并从本仓发布。** 否决：内容仍要走单仓 PR 流程，而那正是本次要移除的成本；市场构建也会继续读工作树路径而不是钉扎提交。

**等 dsh-presets 发一版再切聚合包。** 否决：registry 上已有由这批源码构建的 0.4.1，聚合包可以现在就切，卫星仓的版本线之后再独立推进。

**从零另写卫星仓的内容门禁。** 否决：第二份「什么算合法预设」的定义会与市场构建漂移。`scripts/preset-catalog.cjs` 是有意复述那批不变量，钉扎所对照的权威仍然是市场构建。

**把 ru 字典随包一起搬走。** 否决：`dsh-i18n` 是家族全部命名空间第三语言的唯一归属，它按字符串而非依赖解析命名空间。它的 `preset-center` 条目保留，审计现在把该命名空间报为没有受审计包注册——与 pet 命名空间自其拆分之日以来的状态一致。

## 后果

- 本仓发布十五个包而不是十六个；`family-packages` 发现、发布清单、覆盖率基线与测试标准基线各自减少一个包。
- 本仓提交 `lib/` 的包变成两个（`dsh-market`、`dsh-web-all`）而不是三个；`libs:check` 记录两份源码指纹。
- `scripts/sync-shared.mjs` 生成 96 份副本而不是 101 份：预设中心不再以 vendored 副本接收 mount-once、dsh-home、run-guarded、loopback 与 http 助手。dsh-presets 按其它卫星仓的方式自带这些副本。
- 聚合包的客户端 bundle 不再内联预设面板。它的浏览器半区改由卫星自己的 loader entry 挂载，因此预设中心的源码改动不再强制重建 `dsh-web-all/lib`；同时面板需要已安装的发布包才能渲染。
- 市场产物只随 submodule gitlink 移动而变：合并的预设要在维护者移动 `satellites/dsh-presets` 并重建 `market/dist` 之后才到达 dsh-market.com，而不是卫星仓一合并就到。
- submodule gitlink 指向的提交必须真实存在于 dsh-presets；在该仓推送之前，全新 clone 无法解析这枚钉扎（已经带有卫星工作树的检出仍能构建）。

## 测试

- dsh-presets：`pnpm preset:check`（32 个预设）、`node --test scripts/preset-catalog.test.mjs`（9 条测试，覆盖全部拒绝路径与已提交目录）、`pnpm typecheck`、`pnpm test`（7 个文件 55 条测试）、`pnpm build`。
- 本仓：`aggregate:check`（14 行、13 个 workspace 依赖、12 个 client 子项）、对着钉扎输入的 `market:check`、`libs:write` 后 `libs:check`（2 个包）、`sync-shared:check`、`typecheck`、`test:scripts`（340 条测试）、`test`、`test:standards`、`docs:check`、`i18n:check`、`emoji:check`、`runtime-deps:check`（扫描 2 个包）。
- `packages/dsh-web-all/tests/satellite-rows.spec.ts` 现在固定预设中心行：行 id、无 shell 包装的直接挂载、声明的 semver 范围、生成器解析外部行所依赖的 `./package.json` 导出、`./preset-center` tombstone，以及它已不在内联的 client 子项里。
