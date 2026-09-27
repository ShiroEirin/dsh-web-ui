# Agent Note: 家族卫星仓库与 npm 消费

Status: implemented

## 问题

皮肤中心、宠物插件与社区插件索引此前都维护在本单一仓库里，市场构建直接按 `packages/` 路径读取它们的资产。这带来三项代价。

皮肤贡献者要对着聚合仓库开 PR：一个新皮肤淹没在十六个插件包之间，评审路由与插件评审混在一起，而且资产只能搭下一次家族发布的顺风车才分发出去。宠物资产形状相同，体量 197 MB。社区索引——决定创意工坊列出哪些第三方插件的那个文件——与消费它的商店同处一仓，于是一行索引更新要等整条插件发布链。

但这些插件在代码上并不耦合：它们从不互相导入，也不导入任何兄弟包，家族共享运行时模块早就通过 `scripts/sync-shared.mjs` 生成的已提交副本抵达它们。把它们绑在本仓的是工具链与产物链，不是源码。

## 决策

这些插件在各自仓库维护，在本仓按已发布的 npm 包消费：

- `@linxin666/dsh-client-ui-skin-center` —— [dsh-skins](https://github.com/zhu1090093659/dsh-skins)，同时承载 42 个皮肤资产与皮肤投稿入口；
- `@linxin666/dsh-pet` —— [dsh-pet](https://github.com/zhu1090093659/dsh-pet)，承载插件与全部宠物资产；
- `@linxin666/dsh-client-ui-community-plugins` —— [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins)，承载 `community.json`；
- `@linxin666/dsh-client-ui-preset-center` —— [dsh-presets](https://github.com/zhu1090093659/dsh-presets)，承载插件与已发布的 `presets/` 目录。预设中心迁得更晚，该决策与下面的布局归属[预设中心迁往 dsh-presets 仓](2026-09-24-preset-center-satellite-repository.zh.md)。

包名保持不变，消费方仍解析同一批 specifier。

聚合包改用 `rows:`（外部 npm 行）加显式 semver 范围挂载它们，不再走 `patchFrom`/`deps`；`packages/dsh-web-all/package.json` 手写这些依赖。行 id 与 `patchFrom` 时期逐字一致（`web-ui-pet`、`web-ui-skin-center`、`web-ui-community-plugins`、`web-ui-preset-center`），既有 profile 无需迁移。这些行原先挂载用的子路径导出（`./pet`、`./skin-center`、`./community-plugins`、`./preset-center`）以 `tombstones:` 保留在 exports 表里，因此记录了 `@linxin666/dsh-web-all/pet` 的 profile 仍可 import，而不会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

### 外部行用容错隔离换独立性

外部行直接挂载真实包名：它没有 `config.plugin`，不被聚合包的 fault-isolation shell 包装，浏览器半区也不再内联进聚合包的 client bundle。壳存在的意义是让单个坏掉的家族插件拖不垮整个启动，这些外部行放弃了这一点。换回来的是：它们的浏览器半区由 loader 从各自的 loader entry 挂载，它们的源码改动不再强制重建 `dsh-web-all/lib`；新契约记录在 `packages/dsh-web-all/AGENTS.md`。

`tests/satellite-rows.spec.ts` 固化让这次交换安全的那些不变量：行 id、直接挂载（无 `config.plugin`）、声明的 semver 范围、`scripts/aggregate.mjs` 解析外部行所依赖的 `./package.json` 导出、保留的兼容 tombstones、`remote-web-ui` 排在 `pet` 之前的顺序，以及四者均已不在 client-children 列表里。

### 市场内容按提交固定

市场构建不从工作树读皮肤或宠物资产，也不从工作树读社区索引。这些内容仓是挂在 `satellites/` 下的 git submodule，submodule 的 gitlink 就是钉扎的提交：`market-inputs.lock.json` 记录哪份输入由哪个 submodule 承载、内容目录在它里面的哪一层，`scripts/market-fetch-inputs.mjs` 把该内容目录物化到 `.market-inputs/`（检出停在该提交就本地复制，否则按该提交下载 tarball；幂等，`--check` 只校验不下载，缺失或过期直接让运行失败），`scripts/market-build` 从那里读取。`--local` 读取 submodule 工作树当前所在的提交，开发者就是用它把卫星检出里的改动送进市场构建：缓存于是记录它读到的那个提交而不是钉扎的提交，离开钉扎提交的检出在不加它时会被提示并忽略，这样构建出的 `market/dist` 不得提交。钉扎的提交必须先推送出去再移动 gitlink：tarball 回退只按 SHA 寻址该提交，因此指向一个只存在于本地检出的卫星提交的 gitlink，会让每一个全新克隆与 CI 的 `pnpm market:fetch` 得到 `HTTP 404`，而移动钉扎的那次运行因为直接复制工作树反而成功，把问题掩盖过去。社区索引同样按提交固定，而不是"npm 解析到什么算什么"：在固定它之前，删掉仓内包会让构建静默读到一份陈旧的已发布索引，产出与已提交 `market/dist` 不再一致的 `manifest/plugins.json`。

`scripts/market-verify-assets.mjs` 走遍生成清单承诺的每个路径，对 `market/dist` 或已部署站点校验，并把服务端字节数与本地文件比对。它必须用 Range GET 而不是 HEAD——Workers 静态资产层对 HEAD 返回 `content-length: 0`。部署流程在 `market:check` 之前拉取；对已部署站点的走查是维护者步骤而不是车道步骤，它每次最多向 Worker 的 `POST /api/asset-attest` 路由提交 500 个路径，读回部署版本用自身 `ASSETS` binding 为每个路径提供的字节数。

从 GitHub runner 发出这项校验会撞上该 zone 对这一出口自身的策略：连续六次运行在 3075 个资产路径中拿到同样的约 150 个 403，串行重核在三分钟探测后一个也没能恢复，而这些路径从住宅网络、两个公共云端抓取器、以及一次完整的本机 3075/3075 走查都返回 200 且字节数与提交一致。拒绝方是托管质询——`cf-mitigated: challenge` 与 `Just a moment...` 插页，走查会把 ray 与 body 开头一并报出——所以该拒绝是该出口上的策略，不是对资产的判决；attestation 调用同样会撞上它：不离开该出口的是测量，而调用仍然要离开。车道因此在不校验已部署站点的前提下部署，这就是它留下的覆盖缺口：部分上传、或清单承诺了源站无法提供的路径，由 `market:check` 对照固定输入、以及维护者按需跑的走查兜住，而不是 CI。该路由是运维面而非客户端面：以共享密钥把关并 fail closed（未配置 503、密钥不符 403，两种情况都不会触碰资产），且不出现在 API catalog、OpenAPI 描述与文档页里。公开的 `--origin` 走查留给策略允许的网络上的运行——瞬时重试、串行重核与「整批 403」提示仍然在那条路径上生效。

### 发布顺序

卫星先发版，本仓才切换，因为聚合包把它们作为 npm 外部行挂载，而挂载冒烟断言的是 registry 路径。`@linxin666/dsh-web-all` 以 semver 范围依赖卫星包：`0.3.25` 携带移除已退役 `settingsScope` 注入的 0.1.7-rc.1 迁移，因此聚合包的挂载冒烟（`scripts/e2e-mount.sh`）在 registry 路径上是绿的，而它的 `FAMILY_TGZS_DIR` 覆盖目录只覆盖本仓构建的包。从下一个版本起它们还与本仓共用同一个版本号：每个卫星先打并发布自己的 `vX.Y.Z`，本仓再把聚合包的卫星依赖范围移到 `X.Y.Z` 并打 `vX.Y.Z`。对齐不追溯——在此之前发布的版本各自保留版本号。逐步流程归属 [dsh-web-release](../../../../.agents/skills/dsh-web-release/SKILL.md)，发布准备记录在 [docs/publish-prep.md](../../../../docs/publish-prep.md)。

## 备选方案

**由本仓生成镜像仓库。** 把三个目录只读镜像到各自的 GitHub 仓，本仓仍是唯一事实源。运营成本最低，也满足"可发现"的目标，但输在贡献目标：镜像上的 PR 无处落地，皮肤投稿仍会回到本仓，镜像只是装饰。

**在当前路径挂 git submodule。** 把三个包以子模块留在 workspace 里，聚合包与市场构建原样可用。否决原因是聚合包的目标是消费已发布包而非工作树：子模块会保留 workspace 链接、客户端内联与重建耦合，还给每个贡献者 clone 增加 detached HEAD 的摩擦。这条否决针对的是把三者当作 workspace 包挂载：同一机制放在 workspace 之外，正是市场内容的钉扎方式——workspace glob 触不到 `satellites/`，而且未检出 submodule 的 clone 仍按固定提交的 tarball 构建市场。

**只抽出资产、插件留在本仓。** 把皮肤与宠物资产搬到内容仓，插件留下。否决原因是插件与其内容共享契约（`skin.json`、`pet.json` v2）和测试套件；拆到两个仓会把校验放在它所校验之物之外。

**把共享构建预设与运行时模块发布成包。** 让卫星依赖已发布的 `shared/`，而不是各自携带 vendored 副本与自己的 `shared/tsdown.client.ts`。本次否决：仓库当初特意选择提交副本，让每个包在 typecheck、test 与 publish 上自包含，反转该策略本身是一个有自身影响面的决定。卫星携带预设与副本，漂移在代价低的地方检查。

**留在本仓，靠 CODEOWNERS 与标签解决。** 最省事，且解决了评审路由，但没解决分发：贡献者仍要 fork 并 clone 一个 monorepo 才能加一个皮肤，统一家族版本仍卡着每一次皮肤发布。

## 后果

- 四个仓各自拥有 CI 与贡献流程；本仓发布不再发布它们，`release.yml` 与 `scripts/lib/family-packages.mjs` 看到的是十五个包，而不是拆分前单仓的十九个。从下一个版本起它们与本仓共用同一个版本号。
- 三行失去聚合包的 fault-isolation shell，它们在插件清单里的标题从 `web-all/<family>` 变成各自的包名。
- SDK cohort 现在要在五个仓推进而不是一个；本次拆分后卫星已同步到 `0.1.7-rc.1`，将来一次 cohort 迁移要碰五个仓。
- 市场站的内容跟随 submodule 的 gitlink：一次合并的皮肤或宠物改动，在维护者把 `satellites/` 下的 submodule 移到该提交、部署流程重建并重新校验之后才到达 `dsh-market.com`，而不是卫星一合并就到。
- `satellites/` 只记录 submodule 而不记录其内容，因此从未检出它们的 clone 仍能构建市场；`git submodule update --init` 是要就地改卫星仓内容时的选择，跳过它的人不必为 199 MB 的宠物仓付出 clone 代价。
- 卫星内容的开发可以在本检出里走完：检出 submodule、改动、用 `--local` 读它、构建。`scripts/capture-previews` 出于同样的理由把预览图写进 `satellites/dsh-skins`。PR 仍然落在卫星仓。
- `.market-inputs/` 是拉取来的构建输入（git-ignored），test-standards 与 emoji 审计会跳过它和 `satellites/`，避免把卫星内容当作一方代码审计。
- 卫星各自携带一份 `shared/tsdown.client.ts` 与 vendored `shared/` 模块；`scripts/sync-shared.mjs` 现在覆盖 96 份副本而不是 114 份，且不再触达它们中的任何一个。
