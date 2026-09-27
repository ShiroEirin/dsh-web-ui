# Agent Note: Issue batch 1716/1719 — 遗留行清理、窄屏抽屉收起与 CI 解红

Status: implemented

## Problem

跟踪器上挂着 10 个 issue，且没有在途工作。按当前 `dev` 顶端（`48dd55b5`）逐条核对时读取了每处被引用的源码位置，而不是采信报告本身。其中三个缺陷在检出里真实可复现；其余七个分别落到「已修但未发布」「插件世代错配」「需要产品决策」或「属于已移除的发布面」，在跟踪器上作答而非改代码（本轮对 #1701、#1710、#1712、#1713、#1714、#1715、#1717、#1692 的判定评论）。

另外 `dev` 本身就是红的：`CI checks` 在 `48dd55b5`（维护者自己的顶端）失败。

**#1719 —— 遗留清理把 YAML 行删了一半。** `stripLegacySkinRows`（`satellites/dsh-skins/src/legacy-bridge.ts`）假设一条 `ui-skin-*` 行恰好占两行（`- id:` 行与它下面那一行），于是只跳过这两行。但宿主自身的工具会写三行行：官方插件管理器与聚合包的插件管理器写 `{ id, name, disabled }`，配置编辑器写 `{ id, name, config }`。残留的续行因此逃过清理并并入上一条 entry，造成该 entry 的键重复。写出的 `cordis.patch.yml` 解析为 `Map keys must be unique`，**下一次**启动以 `failed to parse patches` 终止——写入发生在仍能正常启动的那一次，所以故障延迟一次重启才出现，而手工修好文件也只能撑到再下一次启动。复现方式是在报告者给出的最小 patch 上运行装机函数：输出里 `disabled: false` 紧跟一行 `disabled: true`。

**#1716 —— 窄屏抽屉在并非「选择」的手势上收起。** `installMobileSidebarDismiss`（`packages/dsh-web-all/src/client/index.ts`）把落在 `[data-dsh-part="sidebar-entry"]` 或 `[role="treeitem"]` 内的点击当作选择。而 `stampSemanticParts` 会把**每一个** `[role="treeitem"]` 标记为 sidebar entry；工作区分组行（一个 `aria-expanded` 原地翻转的 `treeitem`）以及该行的操作菜单都落在这个子树里。于是「点分组行展开」在同一帧收起了抽屉（把刚展开出来的会话行藏掉），「点该行的省略号」则在菜单可用之前就把它丢掉。两者正是报告者描述的「分组展不开」与「三个点点不了」。

**CI 变红。** `packages/dsh-update/tests/client-entry-desktop.spec.ts` 把 jsdom origin 钉在 `dsh-app://app/`，这是一个 opaque origin。jsdom 自己的 `localStorage` getter 在该 origin 下抛 `SecurityError: localStorage is not available for opaque origins`，而 vitest 在填充 jsdom 环境的全局时会读取该属性——于是 worker 在环境搭建阶段就死了，vitest 把该文件报成「启动失败」而不是「测试失败」。`pnpm test` 在该包上中止，而它其余 86 条断言全部通过。这是 `dev` 上既有的问题，并非本轮其它改动造成。

## Decision

**#1719 —— 遗留行按整块删除。** `stripLegacySkinRows` 会吃掉缩进深于该行 `- id:` 的每一行（含空行分隔），于是被删行的任何键都不可能再并入上一条 entry。块扫描从 id 行自身取缩进（`/^(\s*)- id:/`），而不是假定它在第 0 列，因此修复在缩进的 `- insert:` 块内同样正确。清理仍只在文本真的变化时回写，干净 patch 保持逐字节不变。修复落在归属仓库（`zhu1090093659/dsh-skins@c5d2a56`），本仓通过移动 gitlink 固定；四个用例分别覆盖顶层三行行、insert 块内三行行、被删行之后跨空行的下一行、以及属于幸存行的续行，四者在旧源码上全部失败。

**#1716 —— 分组行与其操作不是选择。** 分组行提前返回，除非点击的是该行末尾的「新建会话」按钮（它要离开这个列表，仍然折叠）；会话行优先于包住它的分组行，因此展开的分组内选择会话仍然折叠。这与 `packages/dsh-remote-web-ui/src/client/mobile-adapt.ts` 对同一工作区行的既有判定一致，两处对同一列表的适配因此不再互相矛盾。回归用例驱动四次手势——分组行、菜单触发器、新建会话按钮、会话行——分组行那一步在旧源码上失败。

**桌面页 spec 改为安装自己的 scheme，而不是钉一个 opaque origin。** `client-entry-desktop.spec.ts` 在单条用例期间替换环境上的 `location`，并在 `finally` 中还原。插件通过 `pageProtocolOf()` 读取 scheme，该函数接收一个类 window 对象，因此同一条分支仍在可用 origin 之上受测。断言不变：它所代表的 scheme、字典注册、以及缺席的座位。

## Alternatives considered

**先声明 volatile 的 App 配置字段（issue #1717）。** 本轮否决，理由不在于方案本身：报告者指出 `dsh-remote-web-ui` 与 `dsh-usage` 漏掉了 0.1.7 的 volatile 迁移是对的，两者都需要把 `Config` 字段标记 `.volatile()`，并改为在使用点通过实时引用读取。但 `dsh-remote-web-ui` 的 schema 承载配对策略与一个密钥隧道令牌，改它意味着触碰一个本轮无法在真实 GUI 中验证的安全面。已在跟踪器上记为「已定位」并附上具体修法形状，留作独立改动。

**放宽配件选择器来修上下文环（issue #1715）。** 持留而非否决。`ContextMeter` 渲染为外壳自身 `dock` 容器内、`conversation.composer.dock` 槽位宿主的兄弟节点，因此现行配件规则（`… > *`，即槽位的直接子元素）会画统计行却画不到该环。放宽到容器（`[class*="_dock"] > *`）依赖 CSS Module 哈希；直接锚定该环本身则需要锚点，而装机产物显示它只带哈希类名与 `aria-haspopup="dialog"`，没有任何 `data-*` 语义属性。第三条路——让统计行也不再上底，把「配件」收窄为真正的交互配件——属于视觉产品决策。已请报告者在三者中选择。

**放宽 `peerDependencies` 下限以接纳 `0.1.7-alpha.*` 宿主（issue #1712）。** 否决：alpha 世代与 rc/正式世代的 client 服务面确有差异（`settingsScope` 正是在这条边界上被移除，也正是报告者的 0.3.x entry 在等待的东西）。接纳 alpha 宿主会抹掉一个正确的「不兼容」信号。该请求的另一半——单个 entry 未激活不应让整页不可用——属于宿主行为，不在本仓插件面内。

**为账本的原子 rename 加重试以解红全量测试。** 作为范围蔓延否决，且确有掩盖缺陷的风险：`packages/dsh-task-board` 与 `origin/dev` 逐字节相同，其偶发失败是 Windows 上 `ledger-v2.json` 的 `renameSync` 报 `EPERM`，与本轮无关。修它意味着要推理账本的持久化契约，应作为独立改动，而不是在排查期间顺手加个重试。

## Consequences

操作者展开工作区分组或打开其操作菜单时，窄屏抽屉保持打开；选择会话仍然折叠。patch 里带三行 `ui-skin-*` 行的 profile 不会再被改写成非法 YAML，「下次启动起不来」的循环从源头被切断——修复经 `dsh-skins` 到达用户，本仓 gitlink 已固定该提交。

`pnpm test` 不再在 `dsh-update` 上中止；该包的 87 条断言此前所在车道报的是 worker 启动失败。

两个已知缺口被记录而非掩盖。全量测试高负载下 `dsh-task-board` 的偶发失败是既有的、`host-ledger.ts` 中账本原子 rename 在 Windows 上的 `EPERM`；它与 `origin/dev` 完全相同的包上可复现、单独运行时通过，与本轮无关。另外本轮的修复由单测验证：抽屉改动未在真实窄屏 GUI 中演练，也没有截图证据随附，跟踪器评论已明确说明这一点。

本轮验证：`pnpm typecheck`、`pnpm test`（全部包；上述 `dsh-task-board` 偶发是唯一中断）、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm aggregate:check`、`pnpm libs:check`，外加 `dsh-skins` 在其自身仓库中的测试套件（701 条）。宿主半区无需重启 `dsh web`；抽屉改动随聚合客户端 bundle 发布，bundle 重建后刷新页面即可生效。
