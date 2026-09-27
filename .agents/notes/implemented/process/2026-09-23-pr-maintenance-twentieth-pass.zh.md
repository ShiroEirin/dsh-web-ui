# Agent Note: PR 维护运行 2026-09-23（第二十次巡检）——以卫星仓重定向关闭 14 个拆分前的内容 PR

Status: implemented

## Problem

对 `zhu1090093659/dsh-web` 的第二十次维护巡检，承接[第十九次巡检](2026-09-23-pr-maintenance-nineteenth-pass.zh.md)。[家族卫星仓库](../architecture/2026-09-23-family-satellite-repositories.zh.md)记录的卫星仓拆分把皮肤、宠物与社区插件索引迁出了本仓，`reject-non-content-pr.yml` 现在会自动关闭新投错的 PR——但该工作流只在 `opened` / `reopened` / `edited` / `ready_for_review` 时触发，因此拆分前提交的 14 个 PR 仍全部开放。它们每一个改动的内容路径在 `dev` 上都已不存在，永远不可能在本仓合并。本次请求的范围是默认范围（分配给 `zhu1090093659` 的开放 PR，不扫描 Issue）：通知这些 PR 迁往卫星仓，并更新 `pr-issue-maintenance` Skill，让后续运行按卫星仓布局路由。

## Decision

14 个 PR 全部以一条中文重定向评论关闭。用户确认了「评论并关闭」，与 `reject-non-content-pr.yml` 对新投错 PR 的既有处理口径一致。

- 五个皮肤 PR（`#1679`、`#1671`、`#1659`、`#1603`、`#1607`）重定向到 [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 的 `skins/<id>/`，校验 `pnpm skin-center:check`；九个社区索引 PR（`#1689`、`#1684`、`#1681`、`#1666`、`#1626`、`#1526`、`#1488`、`#1479`、`#1399`）重定向到 [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins) 的 `community.json`，校验 `pnpm community:check`。
- 每条评论都写明目标仓、提交路径与校验命令、`market/dist` 生成物不用带，以及新 PR 附回原 PR 链接后既有评审进度直接承接。
- 三条评论带 PR 专属信息：`#1659` 回答了作者悬而未决的作者邮箱问题（在新仓提交前配好 `git config user.email`）；`#1488` 提醒 `subcategory` 在新索引中是必填字段；`#1666` 提醒作者带上 2026-09-23 补的 `npm` 字段。
- `#1607` 以确认而非指引关闭：作者已自行迁移到 [dsh-skins#1](https://github.com/zhu1090093659/dsh-skins/pull/1)，并明确授权关闭原 PR。

同一次运行更新了 `pr-issue-maintenance` Skill：

- `pr-review-common.md` 新增「卫星仓（内容仓）」一节：各卫星仓承载什么、集成分支是 `main`、dsh-web 投错的 PR 由 `reject-non-content-pr.yml` 自动关闭而拆分前存量由人工按「重定向评论 + 关闭」处理、上架 dsh-market.com 仍需移动 dsh-web 的 gitlink 并重建市场产物。
- 内容闸门中失效的仓内路径（`packages/skins/skin-center/skins/`、`packages/dsh-pet/assets/`、`packages/dsh-pet/THIRD_PARTY_NOTICES.md`）改指卫星仓；闸门本身不变。
- 失效的公共规则路径 `~/.dsh/skills/pr-issue-maintenance/pr-review-common.md` 在 `pr-issue-maintenance/SKILL.md` 与共享该文件的 `existing-feature-improvement/SKILL.md` 中都修正为 `~/.agents/skills/pr-issue-maintenance/pr-review-common.md`。

## Alternatives considered

只评论不关闭被否决：这些 PR 的目标路径在本仓已不存在，永远不可能合并；自动化对新投错 PR 一律关闭；留着开放但不可合的 PR 只会让作者继续往一棵无法接受其内容的树上 rebase。

由维护者代迁内容（把皮肤与索引条目搬进卫星仓）被否决：贡献是作者自己的工作，版权与合规声明按规则归贡献者，由作者自己在卫星仓开 PR 并附回原 PR 链接时，评审关系延续得最干净。

只改 `SKILL.md` 被否决：共享闸门在 `pr-review-common.md`，两个 Skill 都读它；只改一个文件会让内容闸门继续指向已删除的路径，并让兄弟 Skill 解析一个不存在的公共规则位置。

## Consequences

dsh-web 已没有拆分前遗留的开放 PR，新投错的内容 PR 由工作流自动关闭。评审连续性是一条约定而非机制：新的卫星仓 PR 附回已关闭的 dsh-web PR，既有结论随之承接——binlecode 在本次巡检前已自行把 `#1607` 迁到 dsh-skins#1，验证了这条路径可行。

皮肤、宠物与社区索引的评审改在卫星仓各自的 `main` 集成分支上进行，同样的内容闸门与插件三性评估在那里生效。卫星仓 PR 合并本身不改变线上商店：上架仍需在 dsh-web 移动 submodule 的 gitlink 并重建 `market/dist`，这仍是本仓的维护者工作。

Skill 现在按仓库而不是按仓内路径路由内容贡献，`pr-issue-maintenance` 解析到 `pr-review-common.md` 在 `~/.agents/skills/` 下的真实位置。（2026-09-24：此前共享该公共规则文件的兄弟 Skill `existing-feature-improvement` 已退役删除，该文件现归 `pr-issue-maintenance` 独有。）

取代检查：卫星仓布局本身由[家族卫星仓库](../architecture/2026-09-23-family-satellite-repositories.zh.md)所有，它仍是拆分的 Owning Note；本 Note 只拥有第二十次巡检的处置与 Skill 路由更新，两者交叉链接而非合并。没有更早的 Note 被取代。

## Testing

巡检后的权威状态来自 `gh`（非本地日志）：`gh pr list --state open` 在 `zhu1090093659/dsh-web` 上返回零个开放 PR，14 个关闭各自带着从 `zhu1090093659` 账号发出的重定向评论。卫星仓已确认在接收重定向后的投稿：dsh-skins#1（来自 `#1607`）、dsh-community-plugins#1 与 #2 存在且以各自的 `main` 为目标。

Skill 改动通过回读两个被改文件、并在 `~/.agents/skills` 全目录 grep 确认 `~/.dsh/skills` 与已删除的仓内内容路径均无残留引用来验证。

未验证：本次巡检未评审任何卫星仓 PR（dsh-skins#1 与 dsh-community-plugins#1/#2 等待按更新后规则各自巡检），也尚无贡献者对重定向采取行动。
