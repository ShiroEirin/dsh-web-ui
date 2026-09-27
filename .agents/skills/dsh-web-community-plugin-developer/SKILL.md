---
name: dsh-web-community-plugin-developer
description: Develop a DSH community plugin in the contributor's own repository, and register it in the community plugin index owned by the dsh-community-plugins repository — the index is community.json at that repository's root, its gate is pnpm community:check (node scripts/community-index.cjs --check), and the pull request goes to that repository. dsh-web itself consumes the published @linxin666/dsh-client-ui-community-plugins package and reads the community content pinned by the submodule gitlink when building the market. Use when the user asks to develop a community plugin (社区插件), register/index/接入 a community plugin into the dsh web GUI, update community.json, or asks how community plugins get listed in the settings page.
whenToUse: 用户要开发/新建一个社区插件、把第三方插件登记进社区插件索引、更新 community.json，或询问社区插件如何进入 dsh web GUI 的「社区插件」列表。不适用于：皮肤（dsh-web-skin-developer skill）、宠物（dsh-web-pet-developer skill）、dsh-web 家族插件本身的开发（走 packages/AGENTS.md 与 scripts/dsh-plugin-new）。
disable-model-invocation: true
---

# 社区插件开发者（dsh-community-plugins 社区插件索引）

索引与门禁都在 [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins) 仓库，在 dsh-web 里它是子模块 `satellites/dsh-community-plugins`：索引是该仓库根目录的 `community.json`，校验脚本是 `scripts/community-index.cjs`（附测试），客户端代码在 `src/`。条目字段契约、生成流程与贡献流程以该仓库的 [CONTRIBUTING.md](https://github.com/zhu1090093659/dsh-community-plugins/blob/main/CONTRIBUTING.md) 和 [README.md](https://github.com/zhu1090093659/dsh-community-plugins/blob/main/README.md) / [README.zh.md](https://github.com/zhu1090093659/dsh-community-plugins/blob/main/README.zh.md) 为准，本技能不重复。

## 1. 路径 A：插件本体在贡献者自己的仓库

社区插件的实现完全在贡献者自己的仓库完成，索引只登记元数据并链接过去，dsh-web 不打包第三方代码。插件形态遵循官方 cordis bundle 标准，分层与 exports 约定见 `packages/AGENTS.md`，入桶要点见 `docs/plugins.md`。

## 2. 路径 B：登记进索引（命令全部在 dsh-community-plugins 仓库里执行）

```sh
git submodule update --init satellites/dsh-community-plugins   # 在 dsh-web 克隆里取得工作树；也可以直接 clone 该仓库
git -C satellites/dsh-community-plugins checkout main          # 上一步停在 gitlink 固定的提交（detached），改动提交到 main
cd satellites/dsh-community-plugins
pnpm install
pnpm community:check   # = node scripts/community-index.cjs --check，索引漂移门禁
pnpm typecheck
pnpm test
pnpm build
```

`community.json` 的条目怎么写由该仓库的脚本与文档定义；改完条目跑上面的门禁与测试。

## 3. dsh-web 这一侧

- dsh-web 以已发布 npm 包 `@linxin666/dsh-client-ui-community-plugins` 消费社区插件索引；索引条目的改动是向 dsh-community-plugins 提 PR，不是向 dsh-web 提，`.github/workflows/reject-non-content-pr.yml` 会关闭投错仓库的 PR 并指向正确仓库。
- 市场输入里的 community 内容，取自子模块 gitlink 记录的那个提交；`market-inputs.lock.json` 把 community 输入映射到 `satellites/dsh-community-plugins` 的仓库根（`.`）。
- `pnpm market:fetch` 把 pinned 内容物化进 `.market-inputs/`：子模块工作树正好在 pinned 提交上就复制它，否则下载该提交的 tarball，所以从未初始化子模块的克隆行为一致。
- `pnpm market:fetch --local` 从已初始化的子模块工作树物化它当前所在的提交，用来把你自己的改动送进市场构建；不在 pinned 提交上的检出在不加 `--local` 时会被忽略（运行时输出会说明）。这样构建出的 `market/dist` 来自未 pin 的内容，不得提交。
- 开发循环：编辑 `satellites/dsh-community-plugins/community.json`，然后 `pnpm market:fetch --local` 与 `pnpm market:build`，从 `market/dist` 看市场产物；`pnpm market:check` 校验已提交的 `market/dist` 与 pinned 输入一致。

## 4. 验收清单

- [ ] 插件本体在贡献者自己的仓库，索引里只登记元数据
- [ ] `community.json` 条目通过该仓库的 `scripts/community-index.cjs`
- [ ] 在 dsh-community-plugins 里 `pnpm community:check`、`pnpm typecheck`、`pnpm test` 通过
- [ ] PR 开在 dsh-community-plugins（不是 dsh-web），按该仓库 CONTRIBUTING.md 的要求附证据
- [ ] 改动需要进市场时，`market/dist` 已用 pinned 内容重建并提交，`pnpm market:check` 通过；用 `--local` 构建的产物没有提交

## 5. 常见坑

- **把第三方插件代码提交进 dsh-web**：索引只登记元数据，实现留在贡献者仓库。
- **把索引改动投到 dsh-web**：`reject-non-content-pr.yml` 会关闭该 PR 并指向 dsh-community-plugins。
- **在 dsh-web 里找 `pnpm community:check`**：它是 dsh-community-plugins 的命令，`cd satellites/dsh-community-plugins` 之后才有。
- **提交 `--local` 构建出的 `market/dist`**：它来自未 pin 的内容，`pnpm market:check` 会失败。
