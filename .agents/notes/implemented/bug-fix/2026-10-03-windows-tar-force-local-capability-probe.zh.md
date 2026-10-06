# Agent Note: tar 的 --force-local 标记跟随二进制而非平台

Status: implemented

## Problem

`pnpm test:scripts` 在标准 Windows 主机上失败：`scripts/e2e-mount-rewrite` 的 16 个用例中有 9 个以 `tar: Option --force-local is not supported` 中止，整个脚本套件在任何断言执行之前就红了。此前一直报绿，是因为跑这个套件的车道在 Linux 上。

根因：标记是按平台加的。`scripts/e2e-mount-rewrite`、`scripts/e2e-mount-rewrite.test.mjs` 与 `scripts/publish-legacy-aggregate.mjs` 各自带着同一行，来自 [SDK cohort 笔记](../architecture/2026-09-22-sdk-cohort-0.1.7-alpha-1.md) 记录的判断：GNU tar 会把 `C:\...` 参数当成远程主机规格。

```js
const TAR_LOCAL = process.platform === 'win32' ? ['--force-local'] : []
```

对写下这个判断的那个 shell 来说是对的，对这三个脚本实际运行的那个 shell 来说是错的。Windows 在 `tar` 这个名字后面放了两个无关的程序：GNU tar（Git for Windows、MSYS）有盘符启发式和关掉它的那个标记；随 `System32` 发布、被普通 PowerShell 或 cmd 解析到的 bsdtar（libarchive）两样都没有，遇到未知选项直接中止。于是「平台是 Windows」恰好给了一个会拒绝它的二进制加上标记。意图本身没错——平台检查是在替一个能力问题做回答，而在 Windows 上这是两个不同的问题。

## Decision

`scripts/tar-args.cjs` 直接回答能力问题：在 Windows 上问 PATH 里的 `tar` 是否接受 `--force-local`（`tar --force-local --version`，一次只读探测，GNU tar 退出 0、bsdtar 退出 1），只把标记发给接受过它的二进制。非 Windows 上探测根本不执行，因此 Linux 车道逐字节不变。

这个助手是 CommonJS，因为 `scripts/e2e-mount-rewrite` 是由 `scripts/e2e-mount.sh` 以 shebang 调用的 CommonJS CLI；两个 ESM 调用方通过 Node 的 CommonJS 具名导出检测拿到它的导出，这也是该模块以普通的 `module.exports = { ... }` 赋值结尾的原因。

`scripts/e2e-mount.sh` 刻意保留自己的 `uname` 标记，不在本次改动范围内：它只在 MSYS/MinGW shell 里运行，那里的 PATH 上的 `tar` 按构造就是 GNU tar，所以在那个脚本里做能力探测是多余仪式，而它的可移植性契约本来就已经是那条 `uname` case 语句。

## Testing

- `pnpm test:scripts` 在这台 Windows 主机上转绿：366 用例、20 套件、0 失败，此前是 9 个在任何断言前就中止的失败。此前红的 9 个 `e2e-mount-rewrite` 用例全部通过，`publish-legacy-aggregate` 与新增的 `tar-args` 套件一并通过。
- `scripts/tar-args.test.mjs` 用注入的探针把判断钉住：非 Windows 即使二进制会接受也不发标记；Windows 下会接受才发；Windows 下不会接受则不发。第三个用例用解析出的参数跑 PATH 里真实的 `tar`——这是注入分支证明不了的那一条：在这台机器上它解析为 `[]`，而 bsdtar 对 `tar --version` 退出 0。
- 助手是唯一来源：原先的三份副本都没了，发布路径与挂载冒烟不可能再对标记产生分歧。

## Alternatives considered

- **按 tar 的实现而非探测来选标记。** 否决：没有可移植的办法在不真正运行一个 tar 的前提下问出 PATH 里是哪一个（`tar --version` 的输出在不同构建和分支间不同，而 Git for Windows 只在 Git shell 里把自己的放到 PATH 前面）。选项探测就是真正在被问的问题，且问的是会回答它的那个二进制。
- **一律传 `--force-local` 并要求 GNU tar。** 否决：那会破坏发布助手同样运行其上的标准 Windows 主机，而这正是本笔记要闭合的失败。
- **永不传该标记，改用相对路径或正斜杠路径。** 否决：那是用一个路径规范化层去换掉一个 Windows 专用技巧，而且对 bsdtar 一侧毫无帮助——它本来就把 `C:\...` 当本地路径读。
- **把 tar 调用换成 Node 的归档库。** 否决：这些助手之所以 shell out 是有理由的——它们处理的就是 `pnpm pack` 产出的那些确切 tarball，而自己再实现一套打包/解包语义的代价远大于一个参数列表。
- **把 `scripts/e2e-mount-rewrite` 改名为 `.mjs` 以便一个 ESM 助手服务所有调用方。** 作为对发布关键 CLI 的范围蔓延否决：那会牵动 `e2e-mount.sh`、拥有该 cohort 冒烟契约的笔记，以及 shebang 调用方式，而这次改动的全部内容只是一个参数列表。

## Consequences

- 脚本套件在 Windows 工作站上可运行了，而此前不可：那里的每个 `e2e-mount-rewrite` 用例都够不到，因此发布助手依赖的打包/解包/重打包路径在当地毫无证据。
- Windows 上每个进程多一次只读的 `tar --version` 生成（模块加载时一次）。它换掉的是三份可能各自漂移的常量。
- 探测是一项行为依赖，不只是可移植性上的小改进：会静默接受未知选项的 tar 会收到该标记并照常工作，而会大声拒绝的 tar 正是探测覆盖的那种情形。未来若有 tar 改变其选项处理方式，会表现为 `tar-args` 套件中真实二进制那条用例失败，而不是发布路径里的静默行为变化。
- `scripts/e2e-mount.sh` 仍是唯一一处标记跟随 shell 而非二进制的地方，这个不对称是刻意的，并写在助手自己的文件头注释里，以免下一个读代码的人去「修正」它。
