# Agent Note: 市场站首页背景动效缺省关闭并持久化

Status: implemented

## Problem

`market/src/index.html` 在 hero 后面挂着一块全屏 WebGL 液态噪波着色器。它是页面上最贵的一件事，却在每次访问时都在跑：`market/src/app.js` 在 program 链接成功后就启动 `requestAnimationFrame` 循环，而开关只能在中途把它停下来。于是有三个问题。一是所有人为一个随后被 CSS 压到几乎看不见的效果付费，因为 `#bgCanvas.ready` 只有 `opacity: .42`，还叠着 `filter: saturate(.65) brightness(.72)` 和 screen 混合的鲸鱼图层。二是「关」并不是真的关：`setEnabled(false)` 只取消动画帧并把最后一帧留在屏幕上，合成开销和常驻的 GPU 缓冲都没省下。三是这个选择在刷新后必然丢失，因为它根本没有落盘，而页面缺省是开的。

## Decision

背景动效缺省不开，用户的选择会被记住。

- localStorage 键 `dsh-market-motion` 存 `'1'` 或 `'0'`；缺失或无法解析的值即视为关闭。它在 `market/src/app.js` 顶部读取一次，是 WebGL 层与应用层共同读取的唯一真源。
- WebGL 块只做 drawing buffer 的尺寸设置，不画首帧、不启动循环；首帧由应用层 `boot()` 中的 `applyMotion()` 决定。动效关闭时整个动画循环根本不会启动。
- `window.marketWave.setEnabled(false)` 是真正的关闭：停掉循环、清空排队的点击涟漪、摘掉 canvas 的 `.ready` 类使其回到 `opacity: 0`。新增 `isEnabled()`，让测试与 QA 读取这一层的真实状态而不是靠推断。
- `prefers-reduced-motion: reduce` 仍然压过持久化的选择；此时页脚按钮禁用并显示「背景动效：已遵循系统设置」。
- 页脚按钮在文档里就是关闭态（`aria-pressed="false"`、`背景动效：关闭`），首屏即与真实状态一致，不会先闪一下「开启」再被 `boot()` 纠正。

## Alternatives considered

- 保持缺省开启、只把选择持久化：否决。它修好了刷新丢失，但没解决更大的那半：着色器是每帧一次的全视口 pass，首访者在看到效果之前就已经先付了钱。
- 保留最后一帧、把文案写准：否决。留着一块全视口 drawing buffer 会让合成开销与 GPU 显存继续存活，于是看起来省事的做法恰恰是最贵的。而且把它叫「关闭」也正是这次要消除的那种名不副实。
- 一起上按帧耗时自适应降级（帧耗时超限就去掉星点与流星层）：本次不做。缺省访客的循环根本不启动，自适应只影响明确选择开启的人；对这批人来说，一个更安静但仍然连续的开启态效果是可以接受的开销。如果开启态的帧开销后续确实成为问题，它仍然可以作为后续项。
- 瘦身片元着色器：同样暂缓。它的开销只在动效开启时才付出，而削弱它等于为了加速一个默认没人处于的状态，去牺牲选择开启的人的体验。

## Consequences

- 缺省访问不分配 program、不链接着色器、不排任何动画帧，也不保留 drawing buffer。鲸鱼图层、页头、陈列区与网格不受影响，它们是普通的 DOM 与 CSS 图层。
- 想看效果的用户开启一次，之后刷新仍然保持；关闭一次同样会保持。
- `market/dist` 已重新生成并提交，其中包含各份 manifest 的 `generated` 日期变更。
- 当 `satellites/dsh-community-plugins` 检出在低于其 pin 的 gitlink 上时，`node scripts/market-build` 会读取工作树并丢掉目录条目。构建必须基于 pin 指向的提交：运行不带 `--local` 的 `node scripts/market-fetch-inputs.mjs` 会拉取 pin 内容并报告工作树已过期。

## Testing

- `node --test scripts/market-motion-toggle.test.mjs` 在 `node:vm` 上下文里用最小 DOM 与 WebGL 桩执行真实的 `market/src/app.js`，6 个测试通过：缺省关闭、已存的「开」刷新后保持、已存的「关」刷新后保持、页脚按钮落盘并同步文案与 `aria-pressed`、`prefers-reduced-motion` 压过已存的「开」、以及关闭后循环停止、画布清空且不再绘制任何帧。把缺省改回开启会让其中 3 个失败，去掉 `writeMotion` 调用会让持久化测试失败，因此覆盖不是同义反复。
- `node scripts/market-motion-qa.mjs` 在系统 Chrome 里通过本地静态服务驱动已提交的 `market/dist` 并统计真实动画帧数：首访 0 帧，开启后 241 帧，带着已存选择刷新后 198 帧，关闭并刷新后又是 0 帧，且每个关闭态下 canvas 都是 `opacity: 0`。截图在 `docs/archive/market-motion-qa-20261002/`。
- `node scripts/market-build --check` 报告已提交的 dist 是最新的；`pnpm market:check`、`pnpm typecheck`、`pnpm test`、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check` 与 `pnpm emoji:check` 均通过。