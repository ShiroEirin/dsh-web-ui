---
name: dsh-web-skin-developer
description: Develop a skin for the dsh web GUI skin collection in the dsh-skins repository, and submit it there — scaffold with scripts/dsh-skin-new.cjs, author the v2 skin.json manifest plus the skin.css token remap (a pure asset directory at skins/<id>/, no package.json, no build step), validate with scripts/dsh-skin.cjs and the repository's pnpm skin-center:check, then open the pull request against dsh-skins. dsh-web itself consumes the published @linxin666/dsh-client-ui-skin-center package and reads the skin content pinned by the submodule gitlink when building the market. Use when the user asks to create, add, develop, scaffold, or publish a new skin for the dsh web GUI skin collection.
whenToUse: 用户要新建/新增/开发一个皮肤，或把皮肤投稿进皮肤中心，或询问皮肤在哪个仓库开发与发布。不适用于应用/切换皮肤（那是 dsh-skins 的 `dsh-skin.cjs use`），也不适用于只改市场产物；宠物走 dsh-web-pet-developer skill。
disable-model-invocation: true
---

# 皮肤开发者（dsh-skins 皮肤集合）

皮肤的开发与投稿都在 [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓库进行，在 dsh-web 里它是子模块 `satellites/dsh-skins`；一个皮肤就是 `skins/<id>/` 下的纯资产目录（没有 package.json，没有构建步骤）。契约归 dsh-skins 所有：清单 schema 见 [contracts/skin-manifest-v2.schema.json](https://github.com/zhu1090093659/dsh-skins/blob/main/contracts/skin-manifest-v2.schema.json)，插件侧的语义属性契约见 [contracts/semantic-attrs-v1.md](https://github.com/zhu1090093659/dsh-skins/blob/main/contracts/semantic-attrs-v1.md)。目录构成、字段含义与投稿流程以该仓库的 [CONTRIBUTING.md](https://github.com/zhu1090093659/dsh-skins/blob/main/CONTRIBUTING.md) 和 [README.md](https://github.com/zhu1090093659/dsh-skins/blob/main/README.md) / [README.zh.md](https://github.com/zhu1090093659/dsh-skins/blob/main/README.zh.md) 为准，本技能不重复。

## 1. 工作命令（全部在 dsh-skins 仓库里执行）

```sh
git submodule update --init satellites/dsh-skins   # 在 dsh-web 克隆里取得工作树；也可以直接 clone dsh-skins
git -C satellites/dsh-skins checkout main          # 上一步停在 gitlink 固定的提交（detached），改动提交到 main
cd satellites/dsh-skins
pnpm install
node scripts/dsh-skin-new.cjs <name>       # 脚手架，kebab-case 皮肤名，生成 skins/<id>/
node scripts/dsh-skin.cjs validate <dir>   # 契约校验；同一脚本还提供 install / use / list / current / uninstall
pnpm test                                  # 含 scripts/skin-asset-dirs.test.mjs，守卫资产目录形态
pnpm typecheck
pnpm skin-center:check                     # = node scripts/skin-center-catalog-check.cjs --check
pnpm skin-hooks:check
pnpm build
```

`pnpm skin-center:check` 是 dsh-skins 的命令；dsh-web 的根 `package.json` 里没有任何名字含 skin 的脚本。该仓库还带 `scripts/dsh-skin-migrate-v2.mjs`、`scripts/skin-hooks-registry.mjs`、`shared/` 的 vendored 副本和一份提交的 `lib/`。

## 2. dsh-web 这一侧

- dsh-web 以已发布 npm 包 `@linxin666/dsh-client-ui-skin-center` 消费皮肤中心；皮肤本身的改动是向 dsh-skins 提 PR，不是向 dsh-web 提，`.github/workflows/reject-non-content-pr.yml` 会关闭投错仓库的 PR 并指向正确仓库。
- 市场构建读取的皮肤内容，是子模块 gitlink 记录的那个提交；`market-inputs.lock.json` 把 skins 输入映射到 `satellites/dsh-skins` 的 `skins/` 目录。
- `pnpm market:fetch` 把 pinned 内容物化进 `.market-inputs/`：子模块工作树正好在 pinned 提交上就复制它，否则下载该提交的 tarball，所以从未初始化子模块的克隆行为一致。
- `pnpm market:fetch --local` 从已初始化的子模块工作树物化它当前所在的提交，用来把你自己的改动送进市场构建；不在 pinned 提交上的检出在不加 `--local` 时会被忽略（运行时输出会说明）。这样构建出的 `market/dist` 来自未 pin 的内容，不得提交。
- 开发循环：编辑 `satellites/dsh-skins/skins/<id>/`，然后 `pnpm market:fetch --local`、`pnpm market:build`，在 `market/dist/preview.html?skin=<id>&theme=light|dark` 预览。`node scripts/capture-previews <id>` 重拍 `preview/{light,dark}.jpg`，`node scripts/skins-montage.mjs` 生成拼图，这两个脚本属于 dsh-web 仓库。
- `pnpm market:check` 校验已提交的 `market/dist` 与 pinned 输入一致。

## 3. 验收清单

- [ ] 皮肤目录在 dsh-skins 的 `skins/<id>/`，`node scripts/dsh-skin.cjs validate` 与 `pnpm skin-center:check` 通过
- [ ] `preview/{light,dark}.jpg` 已用 `node scripts/capture-previews <id>` 重拍
- [ ] 市场模拟器亮/暗两态渲染正常（`market/dist/preview.html?skin=<id>&theme=light|dark`）
- [ ] 改动需要进市场时，`market/dist` 已用 pinned 内容重建并提交，`pnpm market:check` 通过；用 `--local` 构建的产物没有提交
- [ ] PR 开在 dsh-skins（不是 dsh-web），按该仓库 CONTRIBUTING.md 的要求附证据

## 4. 常见坑

- **把皮肤改动留在 dsh-web 的 `satellites/dsh-skins` 工作树里**：那只是本地预览，投稿仍然要开在 dsh-skins 仓库。
- **提交 `--local` 构建出的 `market/dist`**：它来自未 pin 的内容，`pnpm market:check` 会失败。
- **子模块不在 pinned 提交上**：不加 `--local` 的 `pnpm market:fetch` 会忽略你的工作树，输出里会说明这一点。
- **找 `pnpm skin-center:check`**：它在 dsh-skins，`cd satellites/dsh-skins` 之后才有。
