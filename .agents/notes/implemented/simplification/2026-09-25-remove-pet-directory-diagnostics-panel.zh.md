# Agent Note: 从设置页移除宠物目录诊断面板

Status: implemented

## 问题

宠物插件的设置页（它的 `settings.section` 席位）在布局字段之上渲染了一块「宠物目录诊断」：宿主启动时收集到的每一条注册表警告（`~/.codex/pets/*` 的 v1 兼容读取迁移提示、被 fail-closed 丢弃的清单字段、磁盘上无帧的 frames2d 轨道）都被逐行列出，每行一个绝对本地路径。所有者判定这块内容对一个「选择宠物、调整布局」的页面只是噪音：同样的事实可从 CLI 与宿主日志获得，路径又长又面向机器，而面板正卡在宠物选择器与显示字段之间。

## 决策

该面板已从设置面移除。`PetSettingsCardController` 不再请求 `/api/pet/diagnostics`，不再持有 `diagnostics` 字段，也不再向快照投影 `petDiagnostics`；`PetSettingsCard` 不渲染诊断列表；插件 zh/en 词典与 dsh-i18n ru 词典中的 `settings.diagnosticsTitle` 键已删除；`settings-section.module.css` 中的 `.diagnostics` / `.diagnosticsTitle` 规则已删除。卡片的 `/api/pet/pets` 与 `/api/pet/state` 加载不受影响，宠物选择与暂存显示表单的行为与之前完全一致。

宿主侧保留了它原本就有的全部事实：注册表仍在启动扫描时记录结构化诊断，`PetService.diagnostics()` 与 `GET /api/pet/diagnostics` 路由仍然应答，`node scripts/dsh-pet validate <dir>` 仍会把结构错误判为失败并列出内容警告。被移除的是它们的其中一种呈现——设置页——而不是诊断本身。因此 `dsh-pet` 的中英 README 不再指向「设置 → 宠物目录诊断」，改为指向 CLI 校验器。

引用清扫覆盖：`satellites/dsh-pet` 的 `src/client/PetSettingsCard.tsx`、`src/client/locales.ts`、`src/client/settings-section.module.css`、被删除的 `tests/pet-diagnostics.spec.tsx`、`tests/pet-section.spec.tsx` 与 `tests/pet-settings-dispose.spec.tsx` 中的诊断桩、`src/client/PetSettingsCard.test.tsx`、两份 README 及其 `README.i18n.yaml` 配对记录，以及 `packages/dsh-i18n/src/client/ru/pet.ts`。

## 已考虑的替代方案

保留面板但折叠进展开项：否决——一个把机器路径藏起来的设置页仍然在分发它们，且所有者的指示是移除而非收敛。

只保留 `level: 'error'` 诊断：否决——所报告的噪音几乎全是警告（v1 兼容提示、坏语音包的丢弃），面板对所有者看到的那类安装仍会渲染，却丢掉了能解释它的信息。

连同面板一起删除 `/api/pet/diagnostics`、`PetService.diagnostics()` 与注册表的诊断收集：否决——那些是宿主的诊断事实，被路由族与未来界面使用，而请求针对的是设置面板；一并删除会变成第二项未经请求、且自带测试连带影响的改动。

把诊断改为 toast 或宠物悬浮面板：否决——这是为「没人要求在图里看到的信息」新设计一种交互；「这只宠物为何被拒」CLI 已经能回答。

## 后果

宠物校验失败的安装现在只看到宠物列表、没有解释；原因位于 `node scripts/dsh-pet validate <dir>` 与宿主启动日志。`PetSettingsCardState` 失去 `petDiagnostics` 成员，本包之外若有消费者读取它必须停止——目前设置卡片是唯一消费者。移除同时让每次打开设置页少一次请求，因此失败的端点也不再产生一条静默重试路径。

该改动属于 `dsh-pet` 卫星仓库：在那里提交，本仓库待该提交推送后再移动 `satellites/dsh-pet` 的 gitlink（gitlink 不得钉住未推送的内容）。它同时改动了已构建的客户端 bundle，因此正在运行的 DSH 服务在重启前仍会下发旧的 `lib/client.js`（仅刷新页面不保证重新拉取）。

## 测试

`satellites/dsh-pet`：`pnpm typecheck`、`pnpm test`（45 个文件、554 项全部通过）与 `pnpm build` 均通过；重建后的 `lib/client.js` 不再包含 `settings.diagnosticsTitle`、"Pet directory diagnostics" 或 `/api/pet/diagnostics`。被删除的 `tests/pet-diagnostics.spec.tsx` 由 `tests/pet-section.spec.tsx`（设置页不渲染 `[data-dsh-part="diagnostics"]`、且从不请求该端点）与 `src/client/pet-css.test.ts`（设置样式表不再含诊断规则）的回归断言接替。根仓库：`pnpm i18n:check` 证明删除 ru 键后 zh/en/ru 键集仍对齐，README 配对记录已重录以维持卫星侧 `pnpm docs:check`。未驱动真实 GUI 页面：其宿主受令牌门控，且运行中的服务仍持有改动前的 bundle，故预期该面板在用户重启 DSH 并刷新后消失。
