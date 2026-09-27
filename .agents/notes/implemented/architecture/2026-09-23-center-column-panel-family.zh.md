# Agent Note: 一个中栏面板家族，统一走原生布局座位

Status: implemented

## Problem

`conversation` 槽位是单占的，且外部插件无法在其中声明槽位，因此家族的功能面板
（dsh-ssh、任务看板、技能中心）各自在 DOM 层接管中栏：往中栏追加一个容器、给
`<html>` 打激活属性，再用样式隐藏下面的会话。每一处 shell chrome——行盒几何、
折叠轨道、激活高亮、标签、locale 刷新——都得手写重建，且每次 shell 重构都可能
把它弄坏。

接管还会自我复制：dsh-ssh 的 `mount.tsx` 与 dsh-task-board 的 `board-mount.tsx`
各自维护整套生命周期，约 130 行中约 100 行仅差七个参数，同一行为修复以独立
issue 与提交落地过两次——rc.6 `centerCol` 回退（#243 / #107）、互斥与侧边栏点击
退出（c0a98c715）、locale 路由（170b3df31）、L2 语义属性（d73bffc2a）。随后互斥
又被表达成成对兄弟（每个面板只指名一个兄弟），无法表达三个面板：没指名第三个的
面板会「逻辑上打开、视觉上不可见」，其侧边栏行需要点第二次才回来。

## Decision

**家族面板一律经 shell 自己的槽位渲染。** 面板通过 `ctx.slots.inject` 往
`sidebar.panellist` 注册一行、往布局的 keyed `main` 槽注册页面，并驱动
`ctx.layout.selectPanel`（布局的 `panelInfo` 再回落进面板自己的控制器）。行盒、
标签、tooltip、激活高亮、折叠轨道、面板切换与窗口 chrome 全归 shell，与官方
「插件」「定时」页完全一致。

**布局的 keyed `main` 槽是唯一的占位权威。** `PANEL_FAMILY` 表、
`dsh-panel-activate` 事件、共享源 `shared/client/panel-mount-core.ts` 与
`shared/client/sidebar-entry-core.ts` 及其全部同步副本、以及各包接管包装层
（`mount.tsx`、`sidebar-entry.ts`、包内核心副本）均已删除。占位不再是家族内部
协商的事：shell 渲染被选中的 key，其余卸载。

迁移暴露出两个前置条件，现已成为该模式的组成部分：

1. **面板的视图状态存在自己的 controller 里，绝不放在页面组件内。** 布局只在
   面板被选中时挂载 keyed 页面，因此组件本地 state 会在每次切面板时丢掉打开的
   页签与未完成的编辑。任务看板的状态本来就是 controller 持有；技能中心的页签
   与编辑目标、ssh 的活动页签、「连接」请求与终端会话 id 也迁了进去。
2. **长生命周期资源绝不归视图所有。** ssh 终端的 PTY 会话迁到 Host
   （`src/engine/terminal-sessions.ts`）：会话只创建一次，任意 socket 按 id
   接入，视图卸载只 detach。接管过去靠「已访问的树保持挂载」提供这一点，直接
   去掉会让每次切面板都杀掉正在跑的 shell 会话。

## Testing

- dsh-task-board、dsh-skill-explorer、dsh-ssh 各自的 `native-panel-registry.spec.ts`
  驱动 shell 实际安装的真 `SlotCore`，断言 keyed `main` 条目、list 行
  （id、order、函数式 label）以及 dispose 后两者清空。
- 控制器状态用例（技能中心的 `panel-state.spec.ts` 与 ssh 面板套件）锁定打开的
  页签、编辑目标与终端会话 id 在切面板后仍在，且快照在无变更时保持引用稳定。
- `packages/dsh-ssh/tests/terminal-sessions.test.ts` 直接驱动 Host 会话表：
  detach/reattach 与滚动缓冲回放、显式 close、空闲回收、退出宽限期。
- 各面板组件套件覆盖页面自身渲染与语义属性。

## Alternatives considered

- **保留 DOM 接管**（连同它需要的共享核心）：拒绝——它重复实现 shell 本就拥有的
  chrome，而家族已经为这份重复付过两次账。
- **成对兄弟扩展到三个**（每个面板指名另外两个）：N² 配置，且每加一个面板都要改
  其它面板的挂载；失败形态是配对过期，而不是漏了一行表。
- **各面板自带接管**、靠广播彼此名字互相关闭：零跨包改动，但机制退化成每面板各写
  一套 hack，下一个面板还要再付一次。
- **把接管抽成被家族引用的运行时 npm 包**：拒绝——按浏览器 bundle 纯度规则客户端
  必须自包含；sync-shared 提交副本模式是仓库既有机制，而本次迁移让这套机制彻底
  不再需要。
- **视图改原生，但用离屏持久容器托管终端**：比把会话挪到 Host 省事，却保留了本次
  迁移要退役的 DOM 生命周期，既熬不过刷新也熬不过断连，还要与它本要取代的座位
  并存。
- **技能中心只做换皮、保留浮层模态**：最省事，但面板就无法像家族其它成员那样被
  打开与关闭，而那正是它迁移的目的。

## Consequences

- 新增家族面板 = 一次 `sidebar.panellist` 注册 + 一次 keyed `main` 注册；占位、
  行盒与轨道白得，也没有家族表需要同步。
- 持有活跃资源的面板必须给资源比页面更长的生命周期；Host 侧会话表是参考实现。
- 皮肤里针对注入行的钩子已在 dsh-skins 仓重锚（其 `main` 上的提交 `a342b8e`）：
  这些行现在归 shell。失效的 `[data-dsh-*-entry]` 行属性已删除；契约把
  `sidebar-entry` 这个 part 重新定义为**插件注册的侧栏面板行**，皮肤中心的兼容
  适配器按「CSS-module 行类 + 插件自己输出的字形身份（`data-dsh-panel-entry`）」
  把它补打到 shell 的 `sidebar.panellist` 行上。以该 part 为锚的已发布皮肤因此
  照常生效；面板锚点（`data-dsh-ssh-view`、`data-dsh-skill-explorer-view`、
  `data-dsh-taskboard-view`）与 `data-dsh-plugin` 标记仍留在页面包装层，面板级
  皮肤规则同样照常生效。
- dsh-ssh 是唯一还保留 DOM 层扩展路径的包（`body-mutations` 仍与聚合 shell 和
  usage 卡共享）；该路径服务于家族之外的面板，与占位无关。
