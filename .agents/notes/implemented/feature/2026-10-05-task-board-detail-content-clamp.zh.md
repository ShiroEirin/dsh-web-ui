# Agent Note: 任务看板详情内容钳制

Status: implemented

## Problem

任务详情弹窗此前把描述和执行 Prompt 以完整高度渲染、没有任何上界。从 GitHub issue 同步来的卡片两个字段都有数万字符（观测到最大的卡片描述 3.4 万字符、Prompt 3.5 万字符），打开这种卡片会把执行设置、调度编辑器和执行历史推到单一滚动体的几千像素之下，主要的「执行」按钮实际够不着。同一弹窗里的冻结快照三元组早就限高了（`promptBlock`，240px 自带滚动），同一视图里两类长文本行为不一致。

## Decision

描述和提示词区块改为经 `ClampedMarkdown`（`packages/dsh-task-board/src/client/board/ClampedMarkdown.tsx`）渲染——它是现有 `TaskMarkdown` 渲染器外的钳制封装：

- 内容体通过 `board.module.css` 的 `.clampBody[data-clamped='true']` 封顶 160px（约八行渲染高度），并用 `::after` 渐变淡出到详情表面令牌 `--dsw-alias-bg-base`，让钳制读起来像预览而非硬切断。
- 一个链接样式的切换按钮（`detail.expand` / `detail.collapse`，带 `aria-expanded`）负责展开和收起。按钮只在内容确实溢出时渲染：组件用 `scrollHeight` 对比计算后的 `max-height`（从样式表读回，让 CSS 持有几何；160px 常量兜底无样式表的运行时即测试），并在 `source` 变化、展开/收起以及经 `ResizeObserver` 的弹窗宽度变化时重测。两种状态下都能测量，因为 `overflow: hidden` 不会截断 `scrollHeight`，而展开态的计算 `max-height` 是 `none`，此时读兜底常量。
- 新内容重新从钳制态开始，与详情弹窗在切换任务时重置编辑会话的做法一致。
- 短内容完全不受影响：没有按钮、没有渐隐，除了 `data-clamped="false"` 之外没有属性变化。

账本字段、协议消息、席位契约与提供方接口都不变；钳制只是详情弹窗内的纯呈现层行为。

## Alternatives considered

**纯内部滚动限高（`max-height` + `overflow-y: auto`），与 `promptBlock` 对齐。** 一行 CSS 且在同一个弹窗里有先例，但它会把一个滚动口嵌进详情体的滚动口里，滚轮手势滚动到一半会被内部区域截获，移动端触控滚动的链式衔接也别扭。钳制保持单一滚动属主，并让被收起的内容通过切换按钮可发现。

**整个详情体做区块级折叠（accordion）。** 折叠整段对只想看设置的读者有用，但它改变了每张卡片的默认呈现——包括短卡片——即使内容不长也要多点一次才能看到。钳制只在实测超过阈值时介入，短卡片的渲染逐像素不变。

**详情页改 Tab 布局（内容 / 设置 / 历史）。** 分屏确实能缓解拥挤，但这是导航模型的变化：每次打开都要把执行历史藏到 Tab 后面，也破坏了卡片现状的一眼通读。相对所报的痛点代价太大。

**CSS `-webkit-line-clamp`。** 对含任意 markdown 子节点（标题、列表、代码块）的容器做行数钳制不可靠——它按块盒分别计算行内内容而不是按整个内容体——也没有可靠的溢出信号来条件渲染切换按钮。实测 max-height 对任意 markdown 树都成立。

## Consequences

- 钳制按渲染后的 160px 一刀切，不看内容类型；一张描述只有 200px 高的纯表格或代码块卡片同样会被钳制。切换按钮可还原，渐隐遮罩提示了截断。
- `ResizeObserver` 有保护：没有它的运行时（jsdom）只是不会在尺寸变化时重测。
- 渐隐渐变假设区块落在 `--dsw-alias-bg-base` 表面上（`.detail` 弹窗正是用这个令牌绘制的）；将来若把 markdown 移到别的填充色上，渐隐的目标令牌要跟着改。
- 没有引入新的 `data-dsh-part` 取值，dsh-skins 的语义属性契约不受影响；皮肤继续命中既有详情部件。
- 新 locale 键 `detail.expand` / `detail.collapse` 已入 zh/en（`packages/dsh-task-board/src/client/locales.ts`）与 ru（`packages/dsh-i18n/src/client/ru/task-board.ts`），由 `pnpm i18n:check` 门禁校验。

## Testing

`packages/dsh-task-board/tests/task-detail-clamp.spec.tsx` 覆盖四种状态：短内容不渲染切换按钮；溢出内容从钳制态开始、经切换按钮展开并可再收起；source 变化让已展开的内容体重回钳制；source 收缩到阈值之下后切换按钮消失。jsdom 没有布局引擎，测试因而 stub `HTMLElement.prototype.scrollHeight`——组件消费的唯一几何信号——并带一条写明理由的 `test-standards-allow` 豁免。真实 Web GUI 验证用 Playwright（Edge）在一张同步自 issue、描述 3.4 万字符的卡片上完成：两个区块都钳制在 160px 且切换按钮可用，展开显示全文，重新收起恢复紧凑视图，定时运行、执行历史与状态操作在桌面与 390px 移动视口下都落在同一视口内，无控制台报错。
