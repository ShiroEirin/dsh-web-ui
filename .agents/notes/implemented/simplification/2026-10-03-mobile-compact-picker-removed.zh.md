# Agent Note: 远程输入器的手机紧凑选择器按钮已移除

Status: implemented

部分取代[移动端紧凑模型选择器、对话区裁切修复、覆盖层抑制、鲸鱼开关验证回退](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md)：该记录 Decision 3 的"工具行两个合成图标按钮"在此移除。该记录其余三项修复（不移植 `_body` gap 规则、底部动作板选择器菜单、限定范围的 workbench 抑制、带验证的鲸鱼开关）不受影响，仍在发布。

## Problem

竖屏适配层向官方输入器工具行注入了两个合成图标按钮——方块打开模型列表，层级条打开推理等级列表。它们并非官方控件：适配层用 `document.createElement('button')` 创建它们、`appendChild` 到 `[class$="_composerSeat"] [class$="_tools"]`，用一个 body class（`dsh-remote-compact-picker`）隐藏官方模型/强度文字触发器，并把官方 trailing 行压成零宽，好让上下文环与发送按钮重新锚定到该行。这是 [v79 记录](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md) 里记下的设计。在手机上，这两个按钮是用户从未要求保留的多余控件，还把官方触发器挤出了该行。

## Decision

两个合成按钮、其钻取行为、门控 body class、零宽 trailing 规则，以及两个语言键（`mobile.composer.pickModel`、`mobile.composer.pickEffort`）一并从 `src/client/mobile-adapt.ts`、zh/en 字典与 ru 语言包移除。官方模型/强度文字触发器回到手机上可见，沿用其既有的 trailing 行规则；v79 把官方菜单重塑为触控友好底部动作板的规则（解除 seat transform、菜单钉到视口底部、44px 单元格）保留，因此在手机上选择模型或推理等级仍经官方控件可用。

## Alternatives considered

- **把按钮保留在设置开关后面。** 否决：用户要求的是删除按钮，不是再加一个开关；默认关闭的开关会把钻取机制、body class 与语言键留在一个无人需要的面上。
- **连底部动作板规则一起删掉。** 否决：那些规则适配的是*官方*菜单（它 `right: 0` 锚定到约 170px 宽的触发器，在手机上会飞出左缘）；没有它们官方选择器在手机上不可用。只移除插件自有按钮。
- **保留按钮但不再隐藏官方触发器。** 否决：那会在同一行留下两个指向同一字段的并行控件——重复（而非隐藏）才是这些按钮没有位置的原因。
- **把钻取辅助函数留在文件里以备恢复。** 否决：没有调用者的死代码；若该设计回归，git 历史里有实现。

## Consequences

- 手机输入器重新显示官方模型/强度文字触发器；上下文环与发送按钮回到官方 trailing 行位置。
- 紧凑选择器契约测试反转为移除守卫：生成的样式表不得包含 `dsh-remote-compact-picker`、`dshRemoteModelPick`、`dshRemoteEffortPick`，并有行为测试断言同步 tick 不向输入器工具行注入任何按钮。
- 两个 ru 键随其 zh/en 来源一起离开 `packages/dsh-i18n/src/client/ru/remote-web-ui.ts`，`pnpm i18n:check` 保持通过；[v79 记录](../bug-fix/2026-08-30-mobile-compact-picker-and-render-fixes.md)与[手机远程面记录](../bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md)已就地记录本次移除。
- 聚合客户端 bundle（`packages/dsh-web-all/lib`）内联该浏览器半区，故随本次改动重建并重录指纹。
