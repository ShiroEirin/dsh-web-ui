---
name: dsh-web-pet-developer
description: Create a pet for the dsh-pet plugin in the dsh-pet repository, and submit it there — pet assets live under assets/<id>/ and the manifest contract is owned by dsh-pet (contracts/pet-manifest-v2.schema.json plus the src/manifest-v2.ts implementation); verify with that repository's pnpm typecheck and pnpm test (it has no pet-specific check script), then open the pull request against dsh-pet. dsh-web itself consumes the published @linxin666/dsh-pet package and reads the pet content pinned by the submodule gitlink when building the market. Use when the user asks to create/add/develop/接入 a pet (宠物), build or calibrate a pet spritesheet, register a custom pet, author a status decoration, or asks how pets are discovered and rendered.
whenToUse: 用户要新建/开发/接入一只宠物（桌面宠物、dsh-pet）、制作或校准宠物图集与 pet.json、把宠物贡献进 dsh-pet 的资产目录，或询问宠物如何被发现与渲染。美术与图集生成参考 hatch-pet skill；皮肤走 dsh-web-skin-developer skill。
disable-model-invocation: true
---

# 宠物开发者（dsh-pet 多宠物注册表）

宠物的制作与接入都在 [dsh-pet](https://github.com/zhu1090093659/dsh-pet) 仓库进行，在 dsh-web 里它是子模块 `satellites/dsh-pet`；一只宠物是 `assets/<id>/` 下的一个目录加一份 manifest，新增宠物不需要改宿主或客户端代码。契约归 dsh-pet 所有：schema 见 [contracts/pet-manifest-v2.schema.json](https://github.com/zhu1090093659/dsh-pet/blob/main/contracts/pet-manifest-v2.schema.json)，权威实现见 [src/manifest-v2.ts](https://github.com/zhu1090093659/dsh-pet/blob/main/src/manifest-v2.ts)，第三方素材声明见 [THIRD_PARTY_NOTICES.md](https://github.com/zhu1090093659/dsh-pet/blob/main/THIRD_PARTY_NOTICES.md)。字段清单、图集几何与校验规则以该仓库的 [CONTRIBUTING.md](https://github.com/zhu1090093659/dsh-pet/blob/main/CONTRIBUTING.md) 和 [README.md](https://github.com/zhu1090093659/dsh-pet/blob/main/README.md) / [README.zh.md](https://github.com/zhu1090093659/dsh-pet/blob/main/README.zh.md) 为准，本技能不重复。

## 1. 工作命令（全部在 dsh-pet 仓库里执行）

```sh
git submodule update --init satellites/dsh-pet   # 在 dsh-web 克隆里取得工作树；也可以直接 clone dsh-pet
git -C satellites/dsh-pet checkout main          # 上一步停在 gitlink 固定的提交（detached），改动提交到 main
cd satellites/dsh-pet
pnpm install
pnpm typecheck   # dsh-pet 没有宠物专用的 check 脚本，typecheck 与 test 就是它的验证命令
pnpm test
pnpm build
```

该仓库的 `package.json` 只提供 `build` / `test` / `typecheck` / `prepare`；`scripts/dsh-pet-migrate-v2.mjs`（附测试）是它唯一的宠物相关维护脚本。

## 2. dsh-web 这一侧

- dsh-web 以已发布 npm 包 `@linxin666/dsh-pet` 消费宠物插件；宠物内容的改动是向 dsh-pet 提 PR，不是向 dsh-web 提，`.github/workflows/reject-non-content-pr.yml` 会关闭投错仓库的 PR 并指向正确仓库。
- 市场构建读取的宠物内容，是子模块 gitlink 记录的那个提交；`market-inputs.lock.json` 把 pet 输入映射到 `satellites/dsh-pet` 的 `assets/` 目录。
- `pnpm market:fetch` 把 pinned 内容物化进 `.market-inputs/`：子模块工作树正好在 pinned 提交上就复制它，否则下载该提交的 tarball，所以从未初始化子模块的克隆行为一致。
- `pnpm market:fetch --local` 从已初始化的子模块工作树物化它当前所在的提交，用来把你自己的改动送进市场构建；不在 pinned 提交上的检出在不加 `--local` 时会被忽略（运行时输出会说明）。这样构建出的 `market/dist` 来自未 pin 的内容，不得提交。
- 开发循环：编辑 `satellites/dsh-pet/assets/<id>/`，然后 `pnpm market:fetch --local` 与 `pnpm market:build`，从 `market/dist` 看市场产物。
- `pnpm market:check` 校验已提交的 `market/dist` 与 pinned 输入一致。

## 3. 验收清单

- [ ] 宠物目录在 dsh-pet 的 `assets/<id>/`，manifest 满足该仓库的 `contracts/pet-manifest-v2.schema.json` 与 `src/manifest-v2.ts`
- [ ] 在 dsh-pet 里 `pnpm typecheck` 与 `pnpm test` 通过
- [ ] PR 开在 dsh-pet（不是 dsh-web），按该仓库 CONTRIBUTING.md 的要求附证据
- [ ] 改动需要进市场时，`market/dist` 已用 pinned 内容重建并提交，`pnpm market:check` 通过；用 `--local` 构建的产物没有提交

## 4. 常见坑

- **在 dsh-web 里找宠物检查脚本**：dsh-web 的根 `package.json` 里没有任何名字含 pet 的脚本；验证命令 `pnpm typecheck` / `pnpm test` 在 dsh-pet 里。
- **把宠物改动留在 dsh-web 的 `satellites/dsh-pet` 工作树里**：那只是本地预览，投稿仍然要开在 dsh-pet 仓库。
- **提交 `--local` 构建出的 `market/dist`**：它来自未 pin 的内容，`pnpm market:check` 会失败。
- **子模块不在 pinned 提交上**：不加 `--local` 的 `pnpm market:fetch` 会忽略你的工作树，输出里会说明这一点。
