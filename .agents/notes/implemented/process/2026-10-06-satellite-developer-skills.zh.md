# Agent Note: 卫星开发者 skill 留在拥有它们的仓库

Status: implemented

## Problem

皮肤与宠物开发者 skill 描述的工作——脚手架、契约校验、投稿门禁、pull request——每一条命令都在 dsh-skins / dsh-pet 仓库里执行，skill 本体却放在 dsh-web 单仓的 `.agents/skills/`。真正做这些工作的卫星仓检出里，agent 反而看不到对应的 skill；而 dsh-web 持有的只是它仅以已发布 npm 包与钉版市场输入消费的仓库的分步操作手册。

## Decision

- 把 `.agents/skills/dsh-web-skin-developer/` 移入 dsh-skins 成为 `.agents/skills/dsh-skin-developer/`，把 `.agents/skills/dsh-web-pet-developer/` 移入 dsh-pet 成为 `.agents/skills/dsh-pet-developer/`；两个卫星仓的提交都落在各自的 `main` 并推送，dsh-web 在同一次改动里移动子模块 gitlink（卫星仓三步流程）。
- 改名时去掉 `dsh-web-` 前缀：skill 名跟随拥有它的仓库。
- dsh-web 的 `.agents/skills/` 保留 `dsh-web-community-plugin-developer` 与 `dsh-web-release`；agent-coding 的路由一行与社区插件 skill 的 whenToUse 改为指向卫星仓，不再指向被移除的目录。
- 迁移后的 skill 正文保留 dsh-web 市场侧章节（gitlink 钉版、`market:fetch --local`、`capture-previews`），因为皮肤与宠物改动仍要经市场构建到达用户；指向 dsh-web 文件的链接改为 GitHub URL，因为 skill 不再位于 dsh-web 根下三层。

## Alternatives considered

- 把两个 skill 留在 dsh-web，让 dsh-web 会话继续列出它们：拒绝——DeepSeek Harness 扫描项目根，skill 只服务于它所在的检出；皮肤与宠物制作的起点在卫星仓，且 dsh-web 根指令本就把内容工作路由给卫星仓。
- 把 skill 复制进两个仓库：拒绝——一个事实两个家必然漂移，这正是[技能根决策](2026-09-14-repository-skills-agents-home.md)刚消除的问题。
- 卫星仓内保留 `dsh-web-skin-developer` / `dsh-web-pet-developer` 原名：拒绝——卫星仓自己的 skill 拿消费方单仓名字命名，错述了它的家。

## Consequences

- 在 dsh-skins 或 dsh-pet 打开的会话原生列出各自的开发者 skill；dsh-web 会话不再列出，dsh-web 的路由说明指出去哪里找。
- 卫星仓现在把它自己的投稿指南与其描述的契约、门禁放在一起版本化；卫星侧门禁变化在同一仓库、同一 pull request 里更新 skill。
- 两次 gitlink 移动落在前一个钉版之上、只含 skill 的提交；移动前已核对 `skins/` 与 `assets/` 与各自 origin/main 逐字节一致，市场输入与已提交的 `market/dist` 不受影响。
- [仓库技能统一由 .agents 技能主目录解析](2026-09-14-repository-skills-agents-home.md)继续拥有 dsh-web 技能根；它的四技能列举现在覆盖留下的两个 skill。

## Testing

- dsh-web 的 `git status` 显示两个 skill 目录删除、两个 gitlink 移动，无其他内容变化。
- `pnpm docs:check` 与 `pnpm emoji:check` 通过。
- gitlink 移动后 `pnpm market:check` 通过（只含 skill 的卫星提交让钉版内容目录逐字节不变）。
