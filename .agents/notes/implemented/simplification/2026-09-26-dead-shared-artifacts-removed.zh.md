# Agent Note: 移除两条已死的共享产物路径并同步其事实

Status: implemented

## Problem

一次全仓优化扫描发现两条共享产物：它们的消费方早已消失，却仍按在用的方式被维护。

第一条是 `shared/host/run-guarded.ts`。它的 sync 清单条目仍声明三个消费包副本——`packages/dsh-usage`、`packages/dsh-task-board`、`packages/dsh-git-graph`——且副本与源文件逐字节相同。本仓没有任何包 import 该模块：在全部已跟踪源码中检索 `run-guarded`、`runGuarded` 与 `guardedHandler`，只命中共享源、它的测试、清单、清单的测试以及这三个副本本身。因此这些副本纯属额外维护成本——共享源每改一次就要传播到三个没有任何 TypeScript program、测试工程或 bundle 读取的文件，而 `test:scripts` 会永远校验它们。卫星仓确实消费该模块（`dsh-presets` 从自己的副本 import `guardedHandler`），并各自持有副本；本仓同步什么不影响它们。

第二条是 `shared/tsdown.client.ts` 里的 `mobileBundle`。它用于构建独立移动端页面 bundle，而它失去用途的原因已由 `packages/dsh-remote-web-ui/tsdown.prepare.config.ts` 用文字记录：官方 UI 改为就地适配后，独立移动端 bundle 已在 0.4.0 移除。该函数在本仓与任何卫星仓都没有调用点。它同时是构建预设里唯一使用 `createRequire` 的地方，因此删除它也一并移除了那个 import。

这两条产物还被其决策归属笔记描述失实。[聚合插件故障隔离 shell](2026-09-01-aggregate-plugin-fault-isolation-shell.zh.md) 称 `shared/host/run-guarded.ts`「同步到四个带进程内 HTTP/轮询面的包」，并称 runGuarded 纪律「由 `scripts/sync-shared.mjs` 同步」。这两句对本仓都不成立。

## Decision

两条已死路径均已移除，描述它们的事实现在与实际情况一致。

- `shared/host/run-guarded.ts` 与 `shared/tests/run-guarded.spec.ts` 保留：该模块是带通过测试的共享源，卫星仓按同一形态构建各自的副本。移除的是本仓的 sync 条目——三个声明的目标，以及 `packages/dsh-usage/src/host/`、`packages/dsh-task-board/src/host/`、`packages/dsh-git-graph/src/host/` 下生成的三份副本。
- `shared/tsdown.client.ts` 中的 `mobileBundle` 与其 `node:module` 的 `createRequire` import 已删除。这是对 `tsdown.prepare.config.ts` 中已记录决策（独立移动端 bundle 自 0.4.0 起不存在）的收尾，而非新方向。
- sync 清单在 `scripts/sync-shared.test.mjs` 中的组成守卫已从 99 份总副本、48 份 host 副本更新为 96 与 45，注释同时记录了 `run-guarded.ts` 为何不在本仓同步，以免后来者重新加回。统计 `/src/client/` 副本的桶保持 39 不变，这正是「本次移除只动了 host 一侧」的校验。
- [聚合插件故障隔离 shell](2026-09-01-aggregate-plugin-fault-isolation-shell.zh.md) 两侧语言均已更正：删除「同步到四个带进程内 HTTP/轮询面的包」这一插入语，结尾句改为说明该纪律按包 opt-in、本仓当前没有包采用，因此共享源与其测试保留而本仓不再生成副本。其决策、备选方案与后果未改动。

这些改动在构造上保持行为不变：没有任何运行时代码 import 这两条产物，改动后 `lib/` 产物逐字节相同——只有 `scripts/lib-artifact-fingerprints.json` 中记录的源指纹发生变化，因为共享构建预设的源变了。

## Alternatives considered

**保留三份副本，只把清单条目标注为有意为之。** 否决：这些副本没有读者，而条目自身的注释（「每个带进程内 HTTP 面的包都会采用它；更多包会逐步采用」）描述的采用并未发生。保留条目等于为一个不存在的消费方维持生成器义务。

**既然本仓没有 import，索性连 `shared/host/run-guarded.ts` 一起删除。** 否决：它是带通过测试的共享源，卫星仓按同一契约在各自副本中消费它。删除源会抹掉本仓向卫星发布的规范定义，同时留下它们的副本。

**把同一次扫描发现的完全相同 helper（`isRecord`、`messageOf`）一并合并。** 延后而非否决：`shared/` 目前没有通用的客户端归属模块，合并需要新增清单目标与配套门禁。记为后续项，不塞进一次删除改动。

## Consequences

清单不再维护没有人读的文件，sync 门禁的副本数为 96。代价是：将来本仓若要消费 `runGuarded`，必须新增清单条目，而不是发现副本已经生成——这正是正确的信号，更新后的测试注释也写明了这一点。卫星仓仍按各自节奏同步各自的副本。