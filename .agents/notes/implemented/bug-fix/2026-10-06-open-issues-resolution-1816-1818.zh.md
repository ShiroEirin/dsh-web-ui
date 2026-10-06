# Agent Note: 开放 issue 处置（#1816、#1818）

Status: implemented

## Problem

两个开放报告，共享同一个根机制。

1. **#1816 —— 插件页开关报 `组件启用失败：HMR transactions cannot be nested`。** 启用/禁用某一行（尤其是 bundle 默认关闭的 `web-ui-liangshen`、`web-ui-ssh`、`web-ui-skill-explorer`）时弹出该错误，且 `cordis.patch.yml` 逐字节未变。报告人比对了两个已发布版本，写入段落逐字节一致，因此 0.4.4 升到 0.4.5 不可能修好。写入位于 `src/host/routes.ts`，跑在调用方的异步上下文里；而 `cordis.patch.yml` 正是 HMR 配置监听器刷新所依据的文件，监听器的刷新会重入 `hmr.runExclusive`，事务嵌套即被拒绝。这与本家族在 [the #1743/#1751 batch](2026-09-29-open-issues-resolution-1743-1751.md) 中已为设置保存修好的缺陷同源。

2. **#1818 —— 移动端发送按钮落在输入框容器之外、紧贴屏幕右缘。** iPhone 竖屏下按钮难以触达；又因为适配层把 Enter 改写成换行，该按钮是唯一的发送路径。报告人无法确认真实选择器，并指出把 `[class$="_composerSeat"] [class$="_primary"]` 的 `right` 改成 56/104/304px、以及改 `_frame` 的 `padding-right`，在真机上都没有任何变化。

## Decision

1. **set-enabled 的写入离开调用方的异步上下文（#1816）。** `setEnabledHandler` 经 `runDetached` 调度它的 `writePatchAtomic`，并且仍然 await，因此响应报告真实的写入结果、下方的快照读取也保持有序。

   该脱附机制移入 `shared/host/detached-work.ts`，并在 `scripts/sync-shared.mjs` 中登记两个消费方——`dsh-remote-web-ui`（其 LAN bind 写入，即原 #1751 站点）与 `dsh-plugin-manager`（本次写入）。一个机制、两份副本，由 `sync-shared --check` 做漂移门禁。模块头注释保留了 [#1754](2026-09-29-open-issues-resolution-1743-1751.md) 更正过的前提：裸 `setImmediate` 并不会开启新的 AsyncLocalStorage store——Node 会把它传播进定时器、promise 续体以及任何绑定当前 async id 的 AsyncResource——因此写入经模块作用域、`triggerAsyncId: 0`（即任何事务存在之前）创建的 `AsyncResource` 调度。

2. **trailing 行把自己的 padding 收进盒内（#1818）。** 适配层把 trailing 行强制成独立一行（`flex-basis:100%`），并给它 116px 的左右 padding（左侧 38px 给命令按钮，右侧 78px 给发送按钮）。在默认 `content-box` 下，这段 padding 会被**加到** 100% basis 之上，于是该行自身的盒比卡片宽出整整 116px，并把绝对定位的发送按钮一起拖了出去。给这一条规则加上 `box-sizing:border-box` 即把 padding 收进 basis。卡片几何完全未动——按钮回到卡内，卡片不增长。

   在 Chrome 393x852 下，用官方 `ConversationRoot`/`InputBar` CSS Modules 加真实适配样式表实测：修复前卡片右缘 x=367，而 trailing 行宽 443px、发送按钮位于 x=433..467——已在视口右缘之外。修复后该行 327px，按钮落在 x=317..351，且在所探测的每个宽度（320/360/393/430）都位于卡内。这 116px 溢出也正是报告人的 `right` 覆盖看起来「毫无作用」的原因：规则确实命中了，但在一个本就溢出的行里重新锚定按钮，按钮依然在卡外。

## Alternatives considered

- **原样采用报告人的 `setImmediate` 补丁（#1816）。** 否决：那正是本家族在 #1754 用实测推翻的前提。轻负载下它可能看起来有效，但它并没有脱附，失败会复现。模块作用域 `AsyncResource` 是同形的改动，但机制真的成立。
- **把 `detached-work.ts` 复制进 `dsh-plugin-manager` 而不移入 `shared/`。** 否决：一份如此微妙的 async-hooks 机制手工维护两份必然漂移，而本仓库对家族共享运行时模块已有唯一归属。共享清单就是这个归属缝。
- **给 trailing 行更小的 `flex-basis`，或去掉 padding（#1818）。** 否决：padding 是承重的（它让命令按钮与发送按钮、以及行自身内容互不重叠），而 `calc(100% - 116px)` 会把同一个数字再编码到第二处。`border-box` 才陈述真实意图——padding 属于该行内部。
- **用绝对 `right` 偏移重新锚定发送按钮（#1818）。** 否决：按钮自身的规则从来不是缺陷所在；把它钉在手工调出的偏移上，官方行一旦增删控件就会重新坏掉。收住该行才能一次性修好所有子元素。
- **在本仓库端到端验证 #1816。** 作为仓库测试不可行：`@deepseek-ai/dsh-hmr` 不是本仓库依赖（测试不得伸进 DSH checkout），事务无法启动。曾写过一个模拟该事务的隔离夹具，发现它测的是自己的双重嵌套而非该缺陷，于是删除而不是留作假证据。回归覆盖因此采用本家族既有形状：放置规则（`set-enabled-hmr-nesting.spec.ts`）加机制（`detached-work.spec.ts`）。

## Consequences

- 插件页开关重新能写入覆盖行，该行在下一次 profile 应用时生效。写入仍被 await，因此失败的写入仍然让请求失败，而不会报成成功。
- 竖屏手机上发送按钮位于输入框卡片右下角、在所探测的每个宽度都在卡内，唯一发送路径可单手触达。
- `shared/host/detached-work.ts` 是本家族该机制的唯一归属；`dsh-remote-web-ui/src/detached-work.ts` 与 `dsh-plugin-manager/src/host/detached-work.ts` 是生成副本，必须经共享源修改。
- 聚合客户端 bundle 内联了适配样式表，因此 `packages/dsh-web-all/lib` 重新构建并重新记录指纹。
- 两个修复都无法在这里对报告人的硬件做确认：#1816 需要挂载了 `dsh-hmr` 的真实 Host，#1818 需要真机 iPhone。#1816 的机制正是本家族已为同一故障在生产中验证过的；#1818 的几何是在 Chrome 下对着官方 CSS Modules 实测的。

## Testing

- `packages/dsh-plugin-manager/tests/set-enabled-hmr-nesting.spec.ts` 固定放置规则：写入经 `runDetached`、脱附包住调度而不是位于回调内部、写入在快照之前被 await、current-vs-desired 守卫仍然抑制空写入。
- `packages/dsh-plugin-manager/tests/detached-work.spec.ts` 在本包副本上固定机制：裸 `setImmediate` 仍观测到事务，`runDetached` 不会，嵌套延期保持脱附，调用方保留自己的上下文。
- `packages/dsh-remote-web-ui/tests/mobile-adapt.spec.ts` 把 trailing 规则上的 `border-box` 声明与其 100% basis、78px 右 padding 一起固定，使该规则不会再次悄悄失去收束。
