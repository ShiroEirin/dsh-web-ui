# Agent Note: 桌面外壳的浏览器认证 cookie 就是任务看板的页面信号

Status: implemented

## Problem

`dsh-task-board` 是家族里唯一在共享回环围栏之上再加一道浏览器信号的宿主路由族：
`browserSameOriginMarker` 只接受 `sec-fetch-site: same-origin` 或任意 `Origin` 头，
两者都没有的请求一律拒绝。八个兄弟族——插件管理器、市场、SSH、技能浏览器、会话归档、用量、
git graph、更新——都只用 `isLoopbackRequest` 做围栏。

官方 DSH 桌面外壳从 `dsh-app://app/` 提供 Web GUI，并为该方案注册自己的 protocol handler：
`/`、`/index.html`、`/assets/*`、`/favicon.svg` 与 `/manifest.webmanifest` 从打包前端读取，
**其余每一条路径都由外壳自己重新发出**，走 `forwardWebRequest`。该转发会从页面请求里删掉
`host`、`origin`、`cookie` 与 `sec-fetch-site`，替换为启动时用 Host 启动链接换来的、
与 authority 绑定的 `dsh-auth-*` 凭据，然后用 Node 的 `fetch` 发出——它只带
`sec-fetch-mode: cors`，完全不带 `Origin` 或 `sec-fetch-site`。因此看板自己的
`/api/task-board/state` 请求到达时没有任何浏览器标记：

    Host: 127.0.0.1:19387
    Cookie: dsh-auth-<authority hash>=v1....
    sec-fetch-mode: cors

`browserSameOriginMarker` 对它返回 false，守卫答
`403 {"ok":false,"error":"forbidden"}`，面板随即渲染它的
`board.hostError.unauthorized` 文案（「登录状态已失效，请刷新页面后重试」）——且只发生在桌面端，
同一个页面走 http origin 时一切正常。

在运行中的桌面宿主上实测：无标记的 `GET /api/task-board/state` 答 403，而
`GET /api/dsh-session-archive/inventory`——同一个 socket、同样缺标记、兄弟围栏——答 200。
缺陷在这条不对称上，不在回环守卫上。

## Decision

任务看板的标记现在也接受 `Cookie` 头里带 harness 浏览器认证 cookie 的请求，即
`@deepseek-ai/dsh-client-connection` 为本 authority 铸出的 `dsh-auth-` 前缀。只有本机上的应用
才拿得到它：桌面外壳从不让它进入页面的 cookie jar，且该 cookie 是
`HttpOnly; SameSite=Strict`，跨站页面既读不到也带不上。

家族早就做过同一个信任判定：`packages/dsh-remote-web-ui/src/loopback-proxy.ts` 把配对设备流量
重新发往 127.0.0.1 时，会同时合成 `sec-fetch-site: same-origin` **和**进程自己的凭据，
好让带绊线的兄弟路由接受它（[remote web-ui trust and resource fixes](2026-09-21-remote-web-ui-trust-and-resource-fixes.zh.md)）。
桌面外壳兑换的是同一枚凭据，但不合成那个标记；接受这枚凭据，就是把同一个决定按外壳实际发出的内容
重新表达一次。

这个标记仍然只是绊线，不是权威判定，与它的文档注释一致。网页的 `Origin` 依旧必须等于 Host 头，
`sec-fetch-site: cross-site` 依旧在任何 origin 被读取之前就被 `isLoopbackRequest` 拒绝，
而没有凭据、也没有标记的请求——裸的本地工具——依旧被拒绝。

## Testing

`packages/dsh-task-board/tests/host-routes.spec.ts` 在真实 HTTP 服务器上跑真实路由栈。新增用例钉住
桌面外壳的转发：只带 `dsh-auth-*` cookie、没有任何浏览器标记时，`GET /state` 与 `POST /action` 答
200；同一枚 cookie 加 `sec-fetch-site: cross-site` 答 403；无标记请求与带无关 cookie 的请求都答
403。该用例在改动前的围栏上失败、改动后通过；该包的 typecheck、build 与全量测试
（558 通过、1 跳过）全绿。

## Alternatives considered

去掉这道额外标记、让看板围栏与八个兄弟族一致，被否决：该标记是有文档、被刻意保留的属性
（「裸的本地 curl 无法操作 agent 控制面」），为了放行一个客户端就删掉它，会把绊线与 docstring 对
所有客户端承诺的性质之间的差距拉大。

接受任意 `Cookie` 头被否决，过于宽松。桌面外壳一定附上 Host 的凭据，但普通浏览器会话也会带
cookie，而仓库自己的先例认定的身份正是这枚具名凭据：`dsh-auth-` 前缀是与 authority 绑定的值，
不是「随便一个 cookie」。

依赖共享围栏放行应用方案 Origin 的方案被否决，并已作为「已否决」记录在案
（[the desktop shell's own scheme at the loopback route fence - rejected](../../rejected/bug-fix/2026-09-25-desktop-shell-origin-route-fence.zh.md)）：
它假定外壳的宿主路由请求携带 `Origin: dsh-app://app`，而外壳在转发前就删掉了 `origin`，
Node 的 `fetch` 也不会补上，因此桌面上没有任何请求会呈现该 origin。它对桌面毫无收益，却对所有
非 web 方案来源放宽了围栏，因此围栏保持原状。

教外壳像 `loopback-proxy.ts` 那样合成 `sec-fetch-site: same-origin`，被否决：外壳就是 DSH 本身，
不在本仓库手里，宿主侧的路由族不能要求未来的外壳版本配合改动。

## Consequences

看板在 DSH 桌面版上可用，且不改动任何其他包；标记对其他客户端照旧生效：认证反向代理、同源 http
页面、配对设备远程通道仍然通过，而无标记的本地工具仍然失败。耦合现在显式落在两个必须一起改的
位置——这里的 `dsh-auth-` 前缀与 `dsh-remote-web-ui/src/inner-auth.ts`——与仓库对
`WEB_PAGE_SCHEMES` 已有的形态一致。

把 `dsh-auth-*` cookie 写进请求的本地进程会通过该标记，正如伪造 `Origin` 头的本地进程早就如此。
权威判定仍是 socket、Host 与 origin 等式检查，所以谁能驱动看板这件事没有变化。
