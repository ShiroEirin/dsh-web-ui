# Agent Note: 任务看板 Host 失败原因与残留锁回收

Status: implemented

## Problem

issue #1528 报告了一块从未挂载过 Host 半区的看板：面板显示 `Host 操作失败：Unexpected token 'o', "not found" is not valid JSON`，任务列表永远为空；磁盘证据是一个 0 字节的 `ledger-v2.lock`，它的 mtime 停在两天前，而正在运行的宿主是之后才启动的。

造成这个现象的是两个缺陷。浏览器传输层把每个响应都当成 JSON 解析，于是核心 Web 服务对未挂载 `/api` 路径返回的纯文本 `not found` 变成了用户看到的错误。而 `HostTaskLedger.acquireLock` 把「读不出内容的锁」当作致命错误，于是异常退出留下的残留文件会一直阻止整个 Host 半区挂载，直到有人手动删掉它。

## Decision

浏览器传输层现在对 Host 失败分类（`not-mounted`、`ledger-locked`、`degraded`、`unauthorized`、`forbidden`、`locked`、`rejected`、`timeout`、`unreachable`、`unexpected`），每一类在当前语言下渲染成自己的那句话；非 JSON 的响应体不会再被交给 `JSON.parse`。事件流连不上时，面板会被提醒去读一次状态（最多每 15 秒一次），因此从未挂载的 Host 半区会显示出来，而不是一直静默空白。

`HostTaskLedger` 会在不可读锁的 mtime 超过 `UNREADABLE_LOCK_GRACE_MS`（60 秒）后回收它。持有者在 `O_EXCL` 之后立刻写入并 fsync 自己的记录，所以存在这么久的不可读锁不可能是正在写入。新的不可读锁仍然 fail closed 并给出恢复提示，被活进程持有的锁仍然拒绝抢占。

看板自身路由的裸 404 是「这些路由不存在」的唯一信号。渲染它之前，传输层会去读家族健康路由 `api/dsh-web-all/degraded`（文档相对，issue #1707），按包名找到本行：若该行在启动时降级，壳记录的 reason 就会取代泛化文案——reason 指向一个活着的持有者时给出 `ledger-locked` 与持有者 pid，否则给出 `degraded` 与原样 reason。这次查找是尽力而为的：缺失、拒绝、读不出或形状未知的回答一律保留 `not-mounted`。

壳的降级记录新增了有界的单行 `reason` 字段，与完整的 `message`（含栈）并存，并由 `GET /api/dsh-web-all/degraded` 提供——纯增量，早于该字段的读者继续用 stage/message。该路由仅限 loopback；家族 `/api/dsh-web-all/rows` 行账本仍会列出插件已降级的行，因为该行确实是 active 的，它的 UI 入口必须挺过这次失败（解释它的信号是降级账本）。

## Alternatives considered

把原始解析错误连同排障文档链接一起显示：否决。面板是报告者唯一能看到的界面，而一句 JavaScript 运行时错误无法说明三种失败中到底发生了什么。

无条件回收不可读锁：否决。在 `openSync(..., 'wx')` 与持有者 `writeFileSync` 之间文件本来就是空的，此时回收会让第二个账本写入者同时写同一份文档。

让看板自己的路由挂在一个「无需账本即可构造」的 Host 服务后面（并用 503 返回构造失败原因）：仍然暂缓而非否决。这是精确报告「另一个活着的 DSH 实例持有账本」的另一条路，代价是看板要多一个「账本不存在」的生命周期状态。读家族健康账本不需要这些代价，因为壳已经记录了原因。

对所有缺失路由一律保留 `not-mounted`、只改文案：否决。它说不出占用者是谁，而且会继续建议重启——而重启显然抢不到另一个进程手里的锁。

## Consequences

失败文案进入任务看板字典以及 `dsh-i18n` 里的俄语镜像。面板现在能区分「接口没挂载」「动作被拒绝」与「账本被另一个进程占用」，这正是排障需要的。

降级家族行为何失败的确切原因，现在只要够得着仅限 loopback 的家族健康路由就能读到，而不再只存在于 Host 日志里。
