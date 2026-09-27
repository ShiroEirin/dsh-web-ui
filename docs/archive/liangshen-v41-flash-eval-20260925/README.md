# 梁神模式 V4.1 Flash 五臂评测证据（2026-09-25）

一次性验证快照，冻结历史，不描述当前行为。当前决策与其依据见 [梁神模式针对 DeepSeek V4.1 Flash 的改进计划](../../../.agents/notes/implemented/feature/2026-09-13-liangshen-v41-flash-improvement-plan.zh.md)；包的用户契约见 [README](../../../packages/dsh-liangshen/README.md)。

## 运行条件

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-25 |
| 仓库提交 | `ad90e46b286b849dd9e59802c9c92ab4710efd02` |
| 出厂 preset 源码 hash | `7102f63b1c7eef5f0c7efa04f5dede4fe4599644a29bd5ef436036498b47a215` |
| DSH 版本 | `0.1.7-rc.2` |
| 固定 route | `deepseek-official/deepseek-flash/max` |
| 平台 | win32 / node v24.14.1 |
| 会话总数 | 27 |
| 总费用 | CNY 1.2051（按 `tools/prices/deepseek-flash.json` 非高峰价） |

运行器为 `packages/dsh-liangshen/tools/benchmark-live-run.mjs`，运行使用隔离的 headless 会话，未中断或重启运行中的 DSH 服务。运行记录位于 `packages/dsh-liangshen/.benchmark-results/`，该目录不提交。

## 批次

| 批次 | 内容 | 会话 | 费用 CNY |
| --- | --- | ---: | ---: |
| Smoke | 协议第 1 步，验证真实会话链路 | 1 | 0.022 |
| A | 出厂语料 7 个任务 × {B, M} | 6 | 0.085 |
| B | 外部查证 3 个任务 × {B, M} | 6 | 0.305 |
| C | 外部查证 3 个任务 × {B, P, T, N, M} | 15 | 0.815 |

## 批次 A：出厂语料探针

7 个任务（代码修复、多轮编辑、失败恢复、工作区指令遵循）× {B, M}，两臂各 6/6 通过，两臂 `web_search` 与 `web_fetch` 均为 0，首次写入前检查次数均值同为 2.0。该语料的任务条件自包含，模型没有查证动机，因此它测不出查证行为差异。这是把外部查证任务并入正式语料的原因。

## 批次 C：五臂矩阵（每臂 3 个任务各 1 次）

查证任务的事实发布于工作区之外：RFC 6585 定义的四个状态码及原因短语、RFC 9110 §9.2.1 定义的 safe 方法及其顺序、SemVer 2.0.0 优先级。判据均为确定性的离线 Node 检查。

| 臂 | 通过 | 直连 search/fetch | run_code 调用 | 工具调用 | 输出 token | 缓存读取 | 费用 CNY | 耗时 s | 工具错误 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B（出厂） | 3/3 | 3 / 6 | 7 | 34 | 14,815 | 617,088 | 0.1341 | 35.0 | 7 |
| P（候选人格） | 3/3 | 4 / 8 | 7 | 36 | 13,233 | 613,504 | 0.1278 | 50.8 | 9 |
| T（ptc） | 3/3 | 0 / 0 | 18 | 18 | 24,075 | 329,728 | 0.1452 | 54.4 | 1 |
| N（原生） | 3/3 | 5 / 14 | 0 | 54 | 17,703 | 574,336 | 0.1230 | 47.5 | 14 |
| M（官方 Minimal） | 3/3 | 8 / 41 | 0 | 90 | 55,829 | 1,214,208 | 0.2854 | 128.7 | 30 |

五臂全部 15/15 通过，四组配对比较（B-P、P-T、T-N、B-M）的差值均为 0.0pp。

## 读法

- **能力维度打平**：五臂在经验证的任务成功率上没有可测差异，这与该项目在 `we-need` 预设上积累的 20 余批实验结论一致——人格措辞改变思考风格与长度，但不改变任务成功率。
- **B 与 M 的差距在成本与时间**：出厂组合以约一半成本、约三分之一时间交付了同等经验证成功。省下的量几乎全在输出 token 上，与该模型的非对称激活结构一致。
- **`ptc` 工具面最干净但不更省**：T 臂是唯一没有直接发起 `web_search`/`web_fetch` 的臂，工具调用与模型自身工具错误也最少，但其输出 token 上升使它在同等成功下更慢也更贵。这支持保留出厂 `both` 默认，同时保留该呈现作为可选配置。
- **候选人格无收益**：B 与 P 在成功率、研究触达与 token 上都在噪声范围内，P 反而更慢。
- **工具错误中相当部分是环境所致**：本机沙箱把 `www.rfc-editor.org`、`datatracker.ietf.org` 等判定为非公网地址而拒绝（`WEB_BLOCKED_URL`），模型因此转投镜像站点。此类传输失败已在新版运行器中与模型自身错误分开计数；本批记录使用的运行器版本尚未包含该字段。

## 局限

每臂仅 3 个任务、1 次重复，Wilson 区间为 43.8%–100.0%。本批数据只能筛选方向，不能支撑稳定结论。费用由外部按价格书换算，运行器当时尚未接入 `--prices`。思维链风格指标可从本批日志读出（170 个推理块中 156 个带正文），但未纳入本快照的统计口径。

## 复现

```sh
cd packages/dsh-liangshen
node tools/benchmark-live-run.mjs --tasks tools/tasks/liangshen-v41-flash.json --groups B,P,T,N,M --repeat 3 --max-sessions 60 --budget-cny 10 --prices tools/prices/deepseek-flash.json
node tools/benchmark-report.mjs .benchmark-results
```
