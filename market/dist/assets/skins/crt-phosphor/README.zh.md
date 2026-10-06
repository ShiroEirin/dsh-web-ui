# 磷光 CRT

[English](README.md) | 中文

dsh web GUI 的 CRT 皮肤：暗玻璃上的磷光绿、覆盖中英文的点阵字体、烘焙进素材的扫描线与暗角，两个网络行者立绘钉在输入框左右两沿。

| | |
| --- | --- |
| id | `crt-phosphor` |
| 版本 | 0.1.0 |
| 清单 | v2 |
| 字体 | Fusion Pixel 12px 等宽（OFL-1.1，随包） |
| 许可 | CC BY-NC-SA 4.0（非官方同人） |

## 预览

亮色：

![亮色](preview/light.jpg)

暗色：

![暗色](preview/dark.jpg)

两张都是 1440x900 JPEG q85，出自官方 facade 渲染器。

## 是什么

- `skin.css` 重映射官方 token：所有文字与描边变磷光绿、所有面板变近黑绿玻璃，31 个 `--dsw-font-*-font-family` 全部指向随包点阵字体；字体用**本地相对路径**的 `@font-face` 声明（本地相对 URL 能过安全管线，远程的不行）。
- `patches.css` 画管子：`#root::before` 暗角 + 缓慢呼吸，`#root::after` 淡辉光 + 偶发闪烁，正文磷光泛光 + 一丝色差边缘，两个立绘在 `body::before/::after`。
- 扫描线**刻意烘焙进素材**：用 CSS 画 3px 周期的线会和设备像素比打架，看起来就是几条粗带在扫。
- **没有 `hooks.mjs`**：市场预览渲染器不执行皮肤 hooks，所以管子刻意做成纯声明式。

## 交互

投稿的这套皮肤是**纯声明式**的：不带 `hooks.mjs`，因为皮肤契约把 `facets.client`
保留给内置皮肤。可选的可交互版本（点左侧立绘，她会把鲸鱼挂件管线里的余额与用量数字
念出来；右键打开那个挂件的菜单）与相关工具放在独立仓库
`lemonhall/dsh-lucy-companion`。

## 立绘

锚定 `[data-composer-card]`（左立绘用 `left: anchor(--crt-composer left)` 配 `translate: -100% 0`），因此侧栏与 details 栏开合都会跟着走，全程不需要测量；层级 `z-index: 900` —— 高于官方那几层（15~40）、低于鲸鱼娘挂件的 `9999`。

`--crt-portrait-filter` 是唯一旋钮：自然色 + 磷光轮廓，或纯绿幽灵双色调，一行切换。

## 来源与版权

**素材均为 AI 生成。** `assets/` 下的所有位图都由图像模型经 OFOX 图像 API 生成，随后在
本地处理。角色形象是纯文本描述的：**没有**把照片、cosplay 图或其它第三方图片作为模型输入。

**哪个模型生成了什么。** 立绘（`lucy-signal-left.webp`、`lucy-signal-right.webp`）与两张
场景（`scene-light.webp`、`scene-dark.webp`）出自 `volcengine/doubao-seedream-5.0-pro`，
逐次记录见 `docs/ART-PROVENANCE.md`；立绘在本地做色度键抠图（键色估计、alpha 斜坡、解混、
去溢色、alpha 阈值、连通域去噪）。更早还有两次背景尝试用的是
`openai/gpt-image-2.5-sunburst`，它们在上述文档里标注为 **superseded**，
**没有任何出货文件来自那两次**。

**与同仓另一套皮肤同源。** 立绘与 `skins/lucy-nightsignal` 用的是**同一批抠图素材**
（同一作者、同一次投稿）；这里的两张场景就是那套皮肤的场景经 `tools/build_crt_assets.py`
处理所得（双色调 + halation、烘焙扫描线、暗角、颗粒）。因此两套皮肤的来源声明完全一致。

**字体。** 随包的 **Fusion Pixel Font** 按 **OFL-1.1** 再分发
（`assets/FUSION-PIXEL-OFL.txt`，上游三方许可在 `assets/licenses/`）。字体保留自身许可，
独立于本皮肤。

**角色与所属作品。** 立绘描绘的是**《赛博朋克：边缘行者》**（Cyberpunk: Edgerunners）中的
**Lucy / Lucyna Kushinada**。角色设计、作品本身与世界观的权利归其权利人：
**Studio TRIGGER** 与 **CD PROJEKT RED**（及其各自的许可方与权利继承人）。

**使用条款。** **仅供个人非商业使用。** 本作品为**非官方同人作品**：与
Studio TRIGGER、CD PROJEKT RED、本仓库维护者以及 DeepSeek Harness 项目**均无关联**，
未获其授权、赞助或背书；角色与作品的一切权利归原权利人。若权利人提出异议，应移除本皮肤。

**贡献者责任。** 本皮肤的贡献者承担其版权与合规责任，并保证有权按此处声明的范围
分发其中的每一个文件：图像由上述模型生成，文字与代码为贡献者本人所作，随包字体按字体
自身的许可再分发。若其中任何部分被认定侵权，贡献者将按要求更正或移除。

**皮肤自身的许可。** 皮肤自己的文件（`skin.json`、`skin.css`、`patches.css`，
以及存在时的 `hooks.mjs`）按 **CC BY-NC-SA 4.0** 发布 —— 见本目录下的 `LICENSE`
与 `skin.json` 的 `licenseUrl`。仓库根目录的 `LICENSE` 是 BSD-3-Clause，覆盖仓库自身
代码，不覆盖本皮肤。两个许可都不授予角色或原作品的任何权利。

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 字体按 12px 网格设计，界面里的奇数号（11、13、14、16）会被轻微插值。
- `patches.css` 有几处匹配 CSS-Modules 哈希类名，官方重建后可能改名（`dsh-skin validate` 会按设计 warning）。
- 字体占皮肤总体积（约 1.3 MB）里的 903 KB；子集化能砍掉约一半，代价是生僻字。

完整推导见项目仓库的 `docs/CRT-TECHNIQUE.md`。
