# Agent Note: 卫星仓 main 分支除所有者与协作者外只能经 PR 合入

Status: implemented

## Problem

四个内容仓——dsh-skins、dsh-pet、dsh-community-plugins 与 dsh-presets——允许任何拥有 write 权限的账号直接向 `main` 提交。它们都没有分支规则集，于是一次改动可以不经 PR、也不让该仓自己的 CI 在这个真正发布的提交上运行，就到达市场构建所钉扎的分支。[卫星仓拆分](../architecture/2026-09-23-family-satellite-repositories.md)把这些贡献迁进各自仓库，正是为了让外部贡献落在那里；而敞开的 `main` 让这些内容无门禁地进入。

## Decision

每个卫星仓的 `main` 挂一个名为 `main-branch-policy` 的活动规则集，只有仓库所有者与拥有 write 权限的协作者保留直推豁免。

- 规则集对 `refs/heads/main` 施加 `pull_request`、`required_status_checks`、`non_fast_forward` 与 `deletion`。
- PR 规则不要求审批，与家族既有合入门禁一致：强制 PR，但不强制 approve。
- 必需检查是各仓自己的 CI 作业——`skin catalog, typecheck, test and build`（dsh-skins）、`migrate script, typecheck, test and build`（dsh-pet）、`community index gate, typecheck, test and build`（dsh-community-plugins）与 `preset catalog gate, typecheck, test and build`（dsh-presets）——合并因此要等该 PR 的门禁转绿。
- `bypass_actors` 在每个仓列入所有者（`zhu1090093659`），并在该账号拥有 write 的三个仓另列入协作者 `Aa728848`。豁免保住了既有的维护者流程：维护者仍可 `git -C satellites/<仓名> push origin main`。
- 没有 write 权限的贡献者对卫星仓的 `main` 开 PR，这正是各仓 CONTRIBUTING.md 已描述的流程。

## Alternatives considered

**用经典分支保护而不是规则集。** 否决：本仓已经用 dsh-web 上的 `integration-branch-policy` 规则集表达同一策略，规则集把豁免名单与必需检查变成显式对象，而不是隐式的保护设置。

**按仓库角色而非具名用户豁免。** 否决：GitHub 没有公开哪个 `RepositoryRole` actor id 对应哪个角色。对 API 的探测确认它接受 id 2、4、5，并以 "Actor base role does not have write permissions" 拒绝 1，但没有任何公开资料说明 2/4/5 中哪个是 admin、maintain 或 write，角色豁免可能授予或拒绝错误的一组而无任何可见信号。具名用户可核对，并沿用 dsh-web 既有规则集。

**要求一个 approve。** 否决：家族既有合入策略在检查转绿后本就不强制评审，本条决策的目的是让每次内容改动都过 PR 与门禁，而不是新增评审瓶颈。

**不要求状态检查。** 否决：那样一个未过卫星仓门禁的 PR 也能合并，而这正是保护要拦下的情形。

**保护全部分支，或限制分支创建。** 否决：超出目标——`main` 才是市场钉扎的集成分支，特性分支保持不受限。

## Consequences

- 每次卫星仓改动现在都以 CI 检查转绿的 PR 到达，或以所有者 / write 协作者的直推到达。
- [CONTRIBUTING.md](../../../../CONTRIBUTING.md) 的维护者流程对其目标读者不变，因为两个豁免账号仍保留直推。
- dsh-presets 的 `bypass_actors` 只列所有者：Aa728848 在该仓是 read 而非 write，要授权需把该账号加进规则集。
- 卫星仓重命名 CI 作业会同时弄坏它的必需检查：上下文是作业的 `name`，改名后的上下文永不汇报，合并会一直阻塞到规则集改指新名字。
- 强推与删除对所有无豁免账号关闭，卫星仓 `main` 的历史重写现在要走豁免路径。
- 验证是从 GitHub API 读回的规则集——活动状态、四条规则、必需检查上下文与豁免名单——以及 `main` 的有效规则端点。阻断本身在本次会话未由非豁免账号实测。
