# Agent Note: 看板析构只释放工具面，不再重绑

Status: implemented

## Problem

在 Windows 上优雅关闭 `dsh web`，每个任务看板提供方暴露的模型可见工具都会打印一行 error：GitHub 扩展一个就是七行 `registration failed ... cannot create effect on inactive context`。行数随工具面放大，于是每次正常关停必然复现，而强杀进程不复现。

cordis 在 fiber 运行 disposer 之前先把它标记为 UNLOADING，而 `Fiber.effect` 拒绝在已停用的 fiber 上创建 effect。看板的挂载 effect 清理会调用 `setToolsEnabled(false)`，它的第一行原本会重绑扩展工具注册表；`setToolRegistry` 会对每个缓冲的提供方工具先释放再重注册，于是这些注册全部变成宿主只能拒绝的请求。注册表捕获该拒绝并按 error 记录，这正是进程仍能干净退出的原因：故障是一次多余的重注册，而不是被破坏的析构。

这个 bug 依赖两个彼此独立的事实。提供方的 `active` 标志是「看板 x 扩展」这道闸，不是宿主的生命周期状态，因此 fiber 卸载期间提供方仍是 `active`；同一个 `setToolsEnabled` 同时服务运行期的设置编辑和析构，于是在一个场景正确、在另一个场景错误的调用同时服务了两者。

## Decision

析构路径只做释放，重注册只留给运行期路径。

- `src/index.ts` 的 `setToolsEnabled(false)` 不再调用 `setToolRegistry`：它释放看板自己的工具句柄后返回。启用路径仍然先重绑注册表，因此「注册表晚到」与「提供方替换」这两条路径（`tools` 的作用域 `inject`、`loader/volatile-update` 提交）行为不变。
- `TaskBoardExtensionRegistry.syncTools` 把带 cordis `INACTIVE_EFFECT` 错误码的拒绝判定为「宿主正在退场」：它丢弃待用的 disposer，不作任何上报。析构期间注册不了的工具不需要诊断，因为片刻之后析构本身就会释放它。其他任何拒绝仍按 error 记录。
- `isInactiveContext` 读取文档化的错误码而不是 import cordis，因此看板不持有对宿主框架的运行时依赖，宿主改写错误文案时这道闸也仍然成立。

两层缺一不可。`index.ts` 的改动消除了本 issue 所指的多余工作；注册表的闸则保证一个在关停期间被要求重绑的看板（例如某个提供方 fiber 恰好在关停中重载）不会打印一条操作者无法处理的拒绝信息。

## Alternatives considered

**只降级日志级别（issue 方案 3：把 `INACTIVE_EFFECT` 降为 debug）。** 否决，因为它只治标。析构仍然按工具数发出一次徒劳的注册，每次都进入 cordis 的 effect 机制，将来任何复用该路径的调用者都会继承这份噪声。它也无法区分「宿主正在卸载」与「定义本身有问题」，而代码层的切分可以。

**只在 `setToolRegistry` / `syncTools` 里判断 fiber 存活（issue 方案 2：fiber 非 active 或 registry 已 dispose 时跳过）。** 否决，因为注册表并不持有 fiber：看板按名字解析可选的 `tools` 服务，必须能在不提供该服务的部署上照常挂载，而能解析到的服务并不是注册所用的那个上下文。从上下文里读 fiber 会把注册表耦合到它刻意不依赖的宿主上，而且对「由已释放作用域提供活注册表的代理」来说，这个判断本身也是错的。

**只把重绑移进 `active` 分支（issue 方案 1），不加注册表闸。** 否决，这是半个修复。它消除了本 issue 点名的那次多余注册，但留下 `syncTools` 仍可能把「关停的正常后果」记成 error。这两处改动属于同一个决定：析构不注册任何东西，而析构期间仍然到达的注册不算错误。

**在宿主交给看板的 logger 席位上过滤。** 否决，因为该 logger 由注册表的每一类失败共用，在那里过滤就必须重新解析错误，才能拿回 `syncTools` 在拒绝现场就已经掌握的那点区别。

## Consequences

优雅关闭 `dsh web` 会释放看板与各提供方的工具面，且不再打印任何注册失败，与强杀进程的表现一致。真正被拒绝的提供方（例如工具名被占用或重复）仍按 error 上报。两个测试文件把这两侧都钉住：`tests/host-shutdown-tools.spec.ts` 用上下文替身驱动析构与注册表的分流，`tests/host-shutdown-fiber.spec.ts` 则在真实 cordis fiber 上跑同一场景、由 `Fiber.effect` 自己抛出该拒绝——三个提供方工具在未修复源码上复现三行 error（GitHub 扩展工具数为七，即七行），在修复后为零行。由于该闸以错误码而非文案为判据，宿主若不再使用 `INACTIVE_EFFECT`，结果是旧的噪声重新出现，而不是把一次真实拒绝悄悄吞掉；该错误码是 cordis 文档化的稳定错误码，测试替身也显式带上了它。
