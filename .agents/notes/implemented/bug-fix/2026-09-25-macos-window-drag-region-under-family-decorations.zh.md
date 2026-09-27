# Agent Note: macOS window drag region under family body-level decorations

Status: implemented

## Problem

官方桌面端以 `titleBarStyle: "hiddenInset"` 建主窗口，且没有任何 JS 双击处理，因此在 macOS 上窗口的可拖拽区域完全由页面声明：每个 chrome 行给自己打上 `data-window-drag`，官方 base 样式表把该标记变成唯一那条 `html[data-platform=darwin] [data-window-drag] { -webkit-app-region: drag }` 规则。macOS 只在该区域内启动窗口拖拽**并**执行系统双击动作（Dock 与菜单栏 →「双击窗口的标题栏以：缩放」），所以区域为空会同时失去这两个交互。

同一张样式表还声明 `html[data-platform=darwin] body>:not(#root) { -webkit-app-region: no-drag }`：每个 body 直接子元素都从窗口区域里做减法。`-webkit-app-region` 可继承，所以 body 级元素还会让整棵子树一起做减法；浏览器交给系统的区域是全部 drag 矩形的并集减去全部 no-drag 矩形的并集——与顺序和绘制无关。因此一个铺满视口的 body 级元素会把**整个窗口**移出可拖拽区域，官方 `[data-window-drag]` 行也不例外。

家族装饰恰好就是这种元素。皮肤中心在控制器创建时把六个固定装饰层挂到 `document.body`，所以在没有启用任何皮肤、自定义主题或壁纸时它们也存在，其中 `background`、`ambient`、`foreground` 在任何状态下都铺满视口；背景模糊开启时，它的 backdrop 模糊纱层是第七个铺满视口的 body 子元素；聚合包的开机过场在每次页面加载的头一秒也是这样一个 body 子元素。它们都声明为非交互（`aria-hidden`、`pointer-events: none`，「decoration must never eat clicks」）——但 `pointer-events` 并不豁免 app-region 计算，只有元素自己的声明才行，而官方选择器（`html[data-platform=darwin] body>:not(#root)`，特异性 1-1-2）压过插件在不加 `!important` 时写下的任何规则。

现象：桌面 profile 挂载插件家族后，在 macOS 上双击窗口标题区域不再让窗口缩放以适应屏幕；不挂载家族时正常。同一机制也让标题区域失去拖动窗口的能力。

## Decision

聚合 compat 层为「非交互的家族 body 级浮层」提供仅桌面端生效的退出声明。

- `packages/dsh-web-all/src/client/index.ts`（`RESPONSIVE_CSS`）声明 `html[data-platform="darwin"] body > :is([data-dsh-skin-layer], [data-dsh-boot-splash], [aria-hidden="true"]) { -webkit-app-region: initial !important; }`。
- `initial` 是该属性的初始值（`none`），使被匹配的元素——以及经由继承的整棵子树——彻底退出 app-region 计算：既不拖拽也不做减法。必须带 `!important`，因为官方选择器特异性更高。
- 三个选择器对应家族装饰的三种形态：皮肤中心的层用其契约属性、聚合包自己的开机过场用其属性、以及任何被页面声明为非交互的 body 直接子元素（`aria-hidden="true"`）——皮肤中心的 backdrop 模糊纱层正是以这种方式标识自己（它不带任何插件属性）。
- 该守卫限定在 `html[data-platform="darwin"]` 与 body 直接子元素上，其他平台与应用子树的行为不变。
- 交互式家族浮层刻意不在范围内：中心列面板（任务看板、ssh）不激活时是 `display: none`，技能中心面板只在打开期间存在，而打开模态时官方的 no-drag 行为与官方设置浮层一致。

## Alternatives considered

- **只修拥有装饰层的那个包。** 作为唯一修复方案被否决：桌面安装从 npm 消费该包（profile 经由聚合包的 `rows:` 解析它），因此那里的修复要等卫星仓发版才能到达运行中的安装，而且它覆盖不到聚合包自己的开机过场或此后新增的家族装饰。守卫放在 compat 层的理由与[视口锁](2026-09-23-viewport-lock-for-installs-without-a-visual.zh.md)相同：聚合包必须对每一种安装都自身成立。
- **整体抵消官方的 body 子元素规则**（`html[data-platform=darwin] body > :not(#root) { -webkit-app-region: initial !important }`）。被否决：它同时会把官方应用自己的 body 级浮层（设置浮层与引导面）移出计算，改变本仓库并不拥有的界面的窗口行为。
- **反过来重新声明拖拽区**（`[data-window-drag] { -webkit-app-region: drag !important }`）。被否决：区域是 `union(drag) - union(no-drag)`，铺满视口的 no-drag 浮层无法从它下方的行上被撤销。
- **把装饰层移出 `document.body`。** 被否决：它们是固定定位、铺满视口、跨包的界面层，带有成文的 z-index 阶梯（background `-2` 到 foreground `41`）；移进应用根元素会改变层叠、绘制顺序与每个皮肤的层叠契约。
- **没有活动视觉时不创建这些层。** 被否决：它们是皮肤运行时的稳定挂载点（component 作用域，跨皮肤切换与客户端重载存活），纱层属于背景功能；按活动视觉门控会给一个纯粹属于 app-region 计算的问题引入创建/销毁生命周期。
- **运行期脚本标记**（扫描 body 子元素里铺满视口的盒子并打上退出属性）。被否决：它需要在每个 mutation 批次都会跑的热路径里读取布局，而样式表能在不做几何启发式的前提下表达同一结果。

## Consequences

- 挂载家族后 macOS 上窗口重新拥有可拖拽区域，系统双击动作（缩放以适应屏幕）与标题区域拖动都恢复；各层的 `pointer-events: none` 契约不变，因为只动了 app-region 计算。
- 匹配依据是 DOM 形态而非包名：任何「body 直接子元素 + 自我声明非交互」的家族装饰都自动被覆盖，无需再改样式表。script 与 style 类型的 body 子元素同样命中选择器，但不占盒面积。
- 家族模态打开时（技能中心）其浮层上方仍然暂停窗口拖拽，与官方设置浮层一致；在家族模态内部恢复拖拽条是另一个决策，本笔记不主张。
- 该守卫是「一个事实的第二处落点」（皮肤中心的层是主要对象）。compat 层这一份必须对已发布的卫星构建成立；若皮肤中心此后在自己的节点上声明同样的退出，本笔记仍然拥有聚合侧的事实，镜像也仍由「卫星版本早于守卫」的安装证明其必要。
- 已验证证据：在本地 `dsh web` 宿主（Playwright，启动后再置 `data-platform="darwin"`）上，四个铺满视口的 body 子元素在改动前测得 `-webkit-app-region: no-drag`，改动后测得 `none`，而三条官方 `[data-window-drag]` 行两次都测得 `drag`。原生双击动作本身没有被合成触发；结论在计算样式/区域输入层面成立。
- 改动只在客户端。宿主直接从被链接的包提供重建后的 bundle，无需重启（已实测），因此刷新页面即可生效；渲染端不提供刷新能力的桌面安装则在下次启动应用时生效。

## Testing

- `packages/dsh-web-all/tests/responsive-contract.spec.ts` 新增用例断言守卫的形态——`html[data-platform="darwin"] body > :is(...)` 作用域、三个标记与 `-webkit-app-region: initial !important`——以及守卫只出现一次；`pnpm --filter @linxin666/dsh-web-all test` 在该文件跑出 12 个用例全绿。
- 针对运行中的 `dsh web` 宿主（链接聚合包 + 桌面 profile 的插件集合）的实机探测：被提供的 `style[data-dsh-compat="responsive"]` 带有该守卫；启动后再置 `data-platform="darwin"`，皮肤中心六个层与其 backdrop 模糊纱层计算为 `-webkit-app-region: none`，三条官方 `[data-window-drag]` 行计算为 `drag`。同一探测在重建之前对同样的层测得 `no-drag`。
- `pnpm libs:check` 针对重建后的 `packages/dsh-web-all/lib/client.js` 与刷新后的 `scripts/lib-artifact-fingerprints.json` 通过。
