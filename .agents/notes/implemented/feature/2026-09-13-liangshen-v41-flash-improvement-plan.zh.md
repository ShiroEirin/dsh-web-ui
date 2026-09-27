# Agent Note: 梁神模式针对 DeepSeek V4.1 Flash 的改进计划

Status: implemented

[English](2026-09-13-liangshen-v41-flash-improvement-plan.md) | 中文

## Problem

梁神模式组合了简短人格提示、工作区指令，以及整个会话生命周期只声明一次的单一工具呈现。现有证据尚不能证明这套组合提高了 DeepSeek V4.1 Flash 的任务成功率，而且工具目录必须准确描述该次请求实际携带的工具面。这一契约必须在任何性能评测有意义之前先修正，评测本身也必须能够计价、把网络失败与模型错误分开，并记录它测量的宿主版本。

本记录接续[四工具锚定与 PTC 语义修正](../../implemented/feature/2026-09-12-liangshen-anchor-tools-and-ptc-refinement.md)、[工作区指令进入系统提示词](../../implemented/feature/2026-09-12-liangshen-agents-md-in-system-prompt.md)和[极简人格与注入式工具目录](../../implemented/feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md)。交付本记录会部分取代那些记录中的分阶段锚定决策：锚定与晋升边界不再是出厂组合的一部分，预设改为整个会话声明一种呈现。

## Decision

提高经验证的任务完成率，同时减少无效工具调用、人工介入和成本，并用数据而非假设确定默认配置。最终交付的决定是**保留出厂默认**：出厂人格与出厂的 `presentation: 'both'`。候选人格与 `ptc` 呈现均不采纳，因为已完成的对照未发现任务成功率差异，也未发现二者在成本或时延上的优势。

真正落地的改进在测量侧而非提示词侧：评测现在能按该路由实际计价的币种计费，能把"工作区无法访问某主机"与"模型靠猜"区分开，并能报告它到底有没有测到宿主版本。

## Context & Efficiency Impact

候选人格在任何影响结果的维度上都不比出厂人格更短：已完成的对照测得任务成功率配对差值为 0.0pp，且在成本与时延上均无优势（同样三个任务下候选人格 50.8 秒、CNY 0.128，出厂人格 35.0 秒、CNY 0.134）。节省 token 本身从来不足以证明性能更好，而这里连节省都没有出现。

`ptc` 呈现确实减少了模型伸手去用的工具面：同样任务下它每次会话发出 6.0 次工具调用，而出厂的 'both' 呈现是 11.3 次、官方 Minimal 是 25.3 次；它也是唯一完全没有直接发起 `web_search` 或 `web_fetch` 的臂，改为在 `run_code` 程序内调用这些工具。这种干净并没有变成优势：它的输出 token 升到每次会话 8,025，而出厂默认是 4,938，结果比出厂默认更慢（54.4 秒）也略贵（CNY 0.145）。成本跟随输出 token，这正是本记录按价格书的币种计价并分列各分量的原因。

## Implementation stages

### 1. Freeze the baseline and acceptance measures

每次运行记录仓库提交与脏状态、出厂预设树哈希、DSH 版本、provider 与 model 路由、推理强度、平台、Node 版本、任务版本与哈希，以及实际下发的变体 patch。DSH 版本从 CLI 读取，并在读取失败时回退到 `dsh` shim 解析到的包版本，因为 Windows 命令 shim 可能返回自身的脚本错误而不是版本号，而该错误文本绝不能被当作基线事实。

独立验收的任务成功率是主指标；任务由工作区内自己的 Node 验收检查判分。运行同时记录回归、指令违反、工具错误、人工介入、耗时、token 用量与成本。`we/let me` 分类只作为诊断性风格数据，永不作为结果指标。

完成条件：同一任务可在隔离环境中重复，各组之间确切的配置差异可被检查。隔离运行把被评预设物化到临时根目录、把会话持久化重定向到那里，绝不写入宿主 home 或真实会话历史。

### 2. Correct tool-catalog accuracy

[tool-catalog.mjs](../../../../packages/dsh-liangshen/presets/liangshen/tool-catalog.mjs) 只宣告该次请求 wire 上实际携带的工具，并在 PTC 下区分可直接调用的 `run_code` 传输与经生成 SDK 可达的工具，同时用 `tool_activate` 指针概述被分页的命名空间。分页在两个面同时强制——组装后的工具列表与 agent scope——因此仅过滤 wire 不会让这些工具族仍可经程序派发触达。

失败回退、压缩恢复与会话隔离得以保留，并由 [tool-catalog.test.ts](../../../../packages/dsh-liangshen/tests/tool-catalog.test.ts) 覆盖，包括首轮多步执行、晋升、缺少 code runtime、呈现失败、恢复与压缩。原生回退后不会继续宣告 PTC。

### 3. Prepare independent prompt and tool-strategy candidates

对照独立地改变人格措辞与工具呈现，且不增加用户可见的预设。[benchmark-live-run.mjs](../../../../packages/dsh-liangshen/tools/benchmark-live-run.mjs) 从出厂预设树物化每个变体：B 组保留出厂人格与呈现，P/T/N 应用候选人格并改变呈现，M 组挂载宿主 bundle 自带的 Minimal 预设作为外部参照。N 组是完整原生工具面，既不是 Minimal 也不是新筛选的精简工具集。

候选人格与组定义作为评测脚手架存在于运行器中。它们不向用户发布，出厂组合也不因它们改变。

完成条件：人格措辞与呈现可独立变化，且不增加用户可见预设。

### 4. Extend the runner and execute staged A/B evaluation

运行受会话数、超时和显式成本预算约束。无法计价的预算会被拒绝而不是被静默解除，因为一个永不触发的闸门会低报其后的每一份结果。

2026-09-25 的评测在固定路由 `deepseek-official/deepseek-flash/max` 上跑了 27 个真实会话，总计 CNY 1.21：1 个协议 smoke 会话、7 个出厂语料任务的探针、3 个外部查证任务的探针，以及这 3 个查证任务上的五臂矩阵。

| 组别 | 人格提示 | 工具策略 | 对照用途 |
| --- | --- | --- | --- |
| B | 出厂 | 出厂呈现 | 基线 |
| P | 候选 | 出厂呈现 | B 与 P 隔离人格影响 |
| T | 候选 | `ptc` 呈现 | P 与 T 比较两种呈现 |
| N | 候选 | 原生工具面 | T 与 N 比较呈现 |
| M | 官方 Minimal | 官方配置 | 外部参照，不用于单因素归因 |

结果：五臂全部 15/15 通过已判分任务，每组配对比较的差值均为 0.0pp。M 组每三个任务花费 CNY 0.285、耗时 128.7 秒，而 B 组为 CNY 0.134、35.0 秒，即出厂组合以约一半成本、三分之一时间交付了同等的经验证成功。没有任何一臂出现因漏查导致的失败。

### 5. Select defaults and complete delivery

默认配置按顺序选择：先看经验证的任务成功率，其次看指令遵循与人工介入，最后看成本与耗时。测得的结果是前两项打平、第三项出厂默认占优，因此出厂人格与 `presentation: 'both'` 保持默认。在这些数据上另作选择等于零收益换成本上升。

交付补齐了证据所需的工具：

- `tools/prices/deepseek-flash.json` 以 CNY 每百万 token 声明已发布价格行，运行器据此计价并通过 `--budget-cny` 执行预算。
- 错误码以 `WEB_*` 开头的工具结果计为传输失败，与模型自身造成的错误并列报告，因此不可达的主机不会被读成模型的错误。
- 每次运行记录其研究调用次数与首次写入前的检查次数，这正是外部 we-need 实验测得中位数由 30 降到 6 的那项护栏指标。
- 种子语料包含事实发布在工作区之外的外部查证任务，以及工作区本地权威任务，使同一护栏在网络不可用时仍可测量。
- [analyze-session.mjs](../../../../packages/dsh-liangshen/tools/analyze-session.mjs) 会报告日志究竟有没有携带推理文本，因为 provider 可能持久化签名的推理块而文本为空串，而对缺失文本计数会读成"实测为零"。

评测使用隔离的 headless 会话，未中断或重启运行中的 DSH 服务。本次交付无需改动出厂预设组合，因此不需要重启。

完成条件：所选配置有可复现证据，文档与交付行为一致，且所需检查有实际记录结果。

## Evidence references

[DeepSeek R1 论文](https://arxiv.org/html/2501.12948v1)、[DeepSeek V3.2 论文](https://arxiv.org/html/2512.02556v1)、[V4.1 Flash 技术报告](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/DeepSeek_V41_Tech_Report.pdf)和[官方 V4.1 Flash 模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)为候选策略提供依据。这些资料没有评测本项目的组合。

[anchored-standard 源项目](https://github.com/xiaobright/dsh-anchored-standard)说明了它面向 V4 Pro 的定位以及其 Flash 证据的局限。

[we-need 预设](https://github.com/walksls/not-smarter-just-faster)报告了在同一模型上的 20 余批实验：人格措辞改变了思考风格与长度，但从未改变任务成功率，其速度优势主要来自少做查证。其发现与本对照一致，并促使上文的护栏指标落地。

已完成的运行记录位于 `packages/dsh-liangshen/.benchmark-results/`，该目录不提交；矩阵目录的交付报告由 `node tools/benchmark-report.mjs <dir>` 重新生成。

## Alternatives considered

将 `ptc` 呈现采纳为新默认未获选择：它产生了所有臂中最干净的工具面与最少的模型自身工具错误，但其输出 token 上升使它在同等的经验证成功下比出厂默认更慢也更贵。它的批处理优势可能仍适合宽扇出的工作负载，因此该呈现保持可配置而非被移除。

采纳候选人格未获选择：配对比较测得任务成功率无差异，成本与时延也无优势，因此改动面向模型的措辞只会带来风险而没有收益证据。

恢复 1024 token 的引导上限，或用 `we/let me` 作为晋升或成功信号，未获选择：截断与输出风格不能确立正确性。

删除工作区指令或缩短 SDK schema 以复现裸 Minimal 提示词，未获选择：必要指令与工具语义属于任务契约的一部分。

新建评测框架或注册独立公开预设，未获选择：现有运行器与配置字段能以更小的改动表达所需对照。

## Acceptance criteria

- 原生与 PTC 目录宣告与实际请求面一致，包括首轮执行、回退、恢复与压缩。
- 现有的工作区指令、计划模式、SDK 契约与会话隔离行为保持覆盖。
- 每次对照都记录来源与运行配置，使用独立验收的结果，并把风格指标分开。
- 报告涵盖不确定性、基础设施失败、成本上限，以及质量与资源之间的权衡。
- 默认配置变更遵循所述证据规则；结果不确定时保留当前策略。
- 文档配对、决策记录与适用的验证证据随实现交付。

## Risks

样本过小或不具代表性时，可能选出会在其他工作负载上退化的配置。Provider 路由与模型更新也会改变结果，因此运行必须记录日期与路由，并在足够接近的时间内完成以支持比较。

矩阵隔离了选定的对照，但并未确立人格措辞与工具呈现之间的所有交互。

预算约束只在价格书与实际收费一致时成立；费率变动或高峰时段运行会让记录的成本失真，直到价格书刷新。本价格书承载的是非高峰价，已发布的高峰价恰为其两倍。

查证语料依赖发布在工作区之外的事实，无法访问这些主机的环境会把任务从"查过了"降级为"查不到"。工作区本地权威任务让护栏在网络缺席时仍可测量，传输失败也被单独报告，但外部任务只与它们面前的网络同样稳定。

三个查证任务是筛选样本，而非稳定估计。五臂在其上打平，因此该测量支持保留当前默认，而非证明当前默认最优。
