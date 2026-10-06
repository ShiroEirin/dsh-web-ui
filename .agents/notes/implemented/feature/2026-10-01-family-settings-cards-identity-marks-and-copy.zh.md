# Agent Note: 家族设置卡片带标识与一行文案

Status: implemented

## Problem

「Web 插件」设置分区（`settings.section` 的 `web-ui-plugins`）打开时先是分区标题、再一行把标题又说一遍的说明，然后是一排彼此无从区分的整宽折叠行：一个名字、一句基本只是把名字换个说法的副标题，加一枚很小的折叠箭头。行内没有任何东西标识插件本身，于是这一页读起来就是两三个一模一样的灰色方块。

文案也没有为它占的位置付出代价。`远程访问设置` / "Remote access settings" 重复了页面自己已经写着的词，而副标题（"配对安全与设备限额。" / "Pairing security and device limits."）把同一件事又说了一遍。看板卡的副标题罗列内部实现（"控制 Host 任务看板、agent 播报与运行期间的系统空闲睡眠保护。"），其下两张主题卡的说明把这份罗列再重复一次，GitHub 区块的说明又重复了父卡自己的内容、它的嵌套位置和它的默认状态。看板卡内部，实时电源事实与电池免责声明以正文字号的裸段落渲染：一整列设置下面最响的文字是一段免责声明。

## Decision

家族插件卡是带标识的行，第二行只写扫描者用得上的信息。

- **分区只渲染标题与卡片。** 说明段落删除，`web-ui-plugins` 在 zh、en 与 `dsh-i18n` 的 ru 镜像里同时去掉 `description` 键：导航项与分区标题已经点明了这一页，那行句子只是把卡片往下推。
- **共享卡片外壳新增可选 `icon`。** 卡片传入时，`PluginSettingsCard` 在标题文本前渲染一枚 34px 的安静标识块（`settings-card.module.css` 的 `.mark`）；不传的卡片保持原有的官方形状卡头，因此嵌套主题卡、提供方区块与内置同级卡片都不受影响。标识块在悬停与展开时取卡片自身的墨色，整行由此读起来是一个控件。
- **卡片标题去掉冗余的名词。** `远程访问设置` 改为 `远程访问`，"Remote access settings" 改为 "Remote access"，`Настройки удалённого доступа` 改为 `Удалённый доступ`，说明改为「手机配对、公网隧道与设备限额。」/ "Phone pairing, public tunnel and device limits."。中文的局域网提示与两份 `dsh-remote-web-ui` README 里写的是旧卡名，一并跟随。
- **说明写卡里有什么，而不是插件是什么。** 看板卡读作「任务编排、agent 播报与目标验收。」/ "Task orchestration, agent announcement and goal acceptance."；它两张主题卡的说明与 GitHub 区块的说明删掉了父卡卡头已经写着的那些词。
- **看板卡的实时事实改为小字。** 电源事实行与电池免责声明移入 `board-settings.module.css` 的 `.power`，以 12px 排在主题卡列表之下，不再作为无样式正文段落渲染。这一块不画自己的分隔线：最后一张主题卡本就用边框收尾。
- **标识沿用家族已有的字形。** 远程访问卡复用侧边栏的 `PhoneIcon`；看板卡自绘三列看板字形，且看板卡内只有它的卡头带标识。

## Alternatives considered

**保留说明行并把它写短。** 否决：那个位置上的任何句子，要么是在重复「Web 插件」四个字，要么是在向已经进到设置页里的人解释设置页；标题加带标识的行用更少的纵向空间传达了同样的信息。

**每一级都加标识，包括嵌套主题卡与提供方区块。** 否决：嵌套列表是一个插件内部的层级，逐级打标识反而把它压平。只有点名插件的那一行才配标识。

**不加 `icon` 属性、只改外壳——行内色条、更大的箭头、更大的内边距。** 否决：报告的问题（两行看起来一样）还在。标识才是让一行在未被阅读前就能被认出的东西；又因为它可选，外壳其余部分不必跟着动。

**删掉插件说明，只渲染单行名字。** 否决：折叠卡上操作者唯一能看到的就是名字时，他无从判断里面有什么；一行有信息量的说明是有效的最小值，而它现在就是卡上唯一的句子。

**把电源免责声明连同其余长文案一起删掉。** 否决：它是运行保证的陈述，不是解释。它保留，只改排版。

## Consequences

- 设置 → Web 插件打开后是标题加带标识的卡片，每张卡的第二行都载有读者可据以行动的信息。
- 选择带标识的卡片无论落在哪个席位都保留标识，包括单独安装时官方 `plugins.bundle.config` 席位（[family plugin card seat](../bug-fix/2026-09-17-family-plugin-card-seat-follows-the-loaded-group.md)）；它旁边的官方卡片不变。
- 文案仍住在各归属包的 zh/en 字典里，ru 镜像在 `packages/dsh-i18n`，三方键集一致性由 `pnpm i18n:check` 把关。设置键、线上字段、账本 schema 与已存值均无变化。
- 此处缩短的嵌套主题卡说明，正是 [task-board settings disclosure cards](./2026-10-01-task-board-settings-disclosure-cards.md) 引入的那两条；该笔记的布局决策不变。
- 覆盖：`packages/dsh-task-board/tests/settings-card-disclosure.spec.tsx` 断言标识位于插件卡卡头之前、而嵌套主题卡保持不带标识的朴素形状；`packages/dsh-web-settings/tests/webui-section.spec.tsx` 断言分区渲染标题与席位、且不再留下任何文案段落。
- 单测之外的证据：隔离的临时 home 宿主（`DSH_HOME=/tmp/dsh-verify-ui`、web profile、`--port 19401`、默认外观）经无头 Chromium 驱动，截图与记录存放于 [设计优化验证快照](../../../docs/archive/2026-10-01-web-plugins-cards-design-pass/transcript.md)（卡片收起、看板主题列表、远程访问表单）。用户自己的宿主全程未重启、未换绑、未被信号。
