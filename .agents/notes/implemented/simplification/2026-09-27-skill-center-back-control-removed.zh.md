# Agent Note: 移除技能中心的「返回会话」控件

Status: implemented

## Problem

技能中心的面板头部带了自己的「‹ 返回会话」控件（`data-dsh-center-view-back`），
点击时调用 `controller.close()`，进而走到 `ctx.layout.selectPanel(null)`。在
DSH 0.2.0-rc.2 上，每次点击都能关闭面板，但界面会卡顿数秒才回到会话视图——每次
点击都可复现，console 无报错。卡顿出在面板切换这条路径上的大范围重渲染，而不是
处理器坏了：#1736 的修复（客户端 `inject` 声明 `layout`）正是让该控件开始生效的
前提，而报障者观察到的“慢”也是同一条切换路径。

该控件还重复了 shell 已经拥有的出口。技能中心是原生中栏页面：它的侧栏行
（`sidebar.panellist`）负责打开面板，而 shell 中每一条“显示会话”的导航——打开会话行、
打开工作区、“新建对话”按钮——本来就会调用 `selectPanel(null)` 把中栏交还给会话。
官方插件页与定时任务页都没有返回控件，技能中心这个反而是外观上的异类。

## Decision

移除技能中心的「返回会话」控件。`SkillPanel.tsx` 只渲染标题头部；从
`panel.module.css` 删除 `.backButton`（`.ghostButton` 保留——列表刷新与编辑器的
返回按钮仍在用）；并从本包的 `zh`/`en` 字典以及 `dsh-i18n` 集中承载的 `ru`
字典中删除已无引用方的 `panel.backToConversation` 键。

面板的打开与离开方式与官方页面保持一致：侧栏行负责选中，任何会话导航都会把中栏
带回会话。`PanelController.open()`/`close()`/`syncPanelSelection()` 未改动——controller
仍然是 `panelOpen`、当前页签与编辑目标的属主，布局的 `panelInfo` 依然回灌其中，
因此面板外部的切换照常工作。

## 面板如何离开

侧栏行是**选中**而不是开合：`SidebarRoot` 的 `PanelRow` 调用 `selectPanel(id)`，
shell 把它直接接到 `ctx.layout.selectPanel(id)`（`ui-sidebar/src/client/index.ts:70-73`）。
因此点击当前已激活的行只是把同一个面板 id 再写一遍，中栏仍停在技能中心——那是重新
选中，不是关闭。真正把中栏交还给会话的出口都是 shell 自己的：

- 打开任意会话行（`navigation.openSession` → `replaceMain(..., 'reveal')`）；
- 打开工作区（`openWorkspace` → `replaceMain(..., 'reveal')`）；
- 侧栏的“新建对话”按钮（`startSession` → `replaceMain(..., 'reveal')`）。

三者最终都走 `this.ctx.layout.selectPanel(null)`。切换到别的面板行（插件、定时任务、
任务看板）同样会离开技能中心，只是经由布局而非插件自身。因此没有任何出口依赖被移除
的控件，而官方插件页与定时任务页拥有的也正是这一组出口。

dsh-ssh 与 dsh-task-board 保留各自的返回控件：它们的会话是宿主侧的长生命周期资源
（SSH 终端、运行中的任务），且报障者并未要求改动这两处。`dsh-web-all/src/client/index.ts`
中面向 `[data-dsh-center-view-back]` 的移动端偏移规则保留，因为那两处控件仍带该标记。

## Alternatives considered

- **不去掉控件，而是排查并修复 `selectPanel(null)` 的开销**：作为本 issue 的持久解法
  被否决。切换路径属于 shell 的布局服务，其成本不由本包拥有；且报障者自己建议的处置
  就是移除，而该控件重复了 shell 已经提供的出口。若 shell 的面板切换仍然偏慢，那是上游
  `@deepseek-ai/dsh-client-ui-layout` 的问题，应按
  [上游根因 issue 分诊](../process/2026-09-06-upstream-root-cause-issue-triage.md)
  单独立 issue 反馈给核心包。
- **保留控件但让它变便宜（延后选择、跳过重渲染）**：否决。这会保留一个冗余出口，并用
  插件侧的变通手段掩盖 shell 拥有的成本，与官方页面越走越远。
- **一次性移除三个家族面板的返回控件**：否决。报障范围限定在技能中心；dsh-ssh 与
  dsh-task-board 托管着活的资源，其出口控件是否保留是另一个问题。

## Consequences

- 技能中心现在与官方插件页、定时任务页一致：只有标题头部，进出经由侧栏行与会话导航。
- 报障的技能中心返回控件多次点击卡顿随控件一并消失：面板内已无任何位置再要求布局
  重新选择会话。布局自身的面板切换成本未变，在面板间或行间切换时依然可观察。
- `panel.backToConversation` 不再是 `dsh-skill-explorer` 命名空间的键；它在仍在使用
  它的 ssh 命名空间中保留。
- `controller.close()` 与 `controller.open()` 已无调用方：侧栏行是选中面板而不是关闭
  面板，会话导航则完全由 shell 发起，生产代码不再要求 controller 开合面板。
  `syncPanelSelection()` 仍在运行——`src/client/index.ts` 把布局的 `panelInfo` 喂给它，
  controller 由此得知面板已打开。这些方法留在 controller 上，是因为面板的打开状态仍由
  controller 如实上报，`toggle()` 也仍在两者间路由；`open`/`close` 如今没有外部调用方，
  是家族形态本身的性质而非缺陷——任务看板的 controller 也是同样的驱动方式。

## Testing

- `tests/panel.spec.tsx` 断言头部只有标题、不再渲染任何 `[data-dsh-center-view-back]`
  节点或返回文案，且页面内没有任何关闭入口。
- `tests/panel-state.spec.ts` 继续锁定布局握手、controller 持有的页签与编辑目标，
  以及引用稳定的快照，并新增出口契约：双向的 `panelInfo` 回灌必须让布局的选中列表保持
  为空，插件因此永远不会成为“重新选中会话”的发起方。该用例经变异检验——让
  `syncPanelSelection` 把选择推回去会使它失败。
- `pnpm --filter @linxin666/dsh-client-ui-skill-explorer test`（123 通过）、
  `pnpm i18n:check`（15 个命名空间，zh/en/ru 1296 键对齐）、`pnpm docs:check`、
  `pnpm typecheck` 与 `pnpm libs:check` 均通过。
