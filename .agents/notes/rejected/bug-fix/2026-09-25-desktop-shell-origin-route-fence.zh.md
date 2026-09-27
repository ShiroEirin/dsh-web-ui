# Agent Note: 桌面外壳自己的方案来源通过回环路由围栏——已否决

Status: rejected — 桌面外壳在转发前就删掉了 `origin`，宿主路由请求从不携带 `dsh-app://app`；挡住面板的是任务看板自己的浏览器标记门

## Problem

家族的宿主路由族对每个请求都做围栏：回环 socket、回环 Host 头与浏览器同源标记
（`shared/host/loopback.ts`）。其中 Origin 检查要求 Origin 的 host 与 Host 头**逐字
相等**。用户可见的现象是：任务看板面板**只在官方 DSH 桌面版**报它的未授权文案
（「Host 操作失败：登录状态已失效，请刷新页面后重试」），同一个页面换成 http 来源则一切正常。

## Proposal (declined)

让共享围栏接受「任何网络传输不承载的方案」的 Origin——桌面外壳的 `dsh-app:`、其它外壳
自己的方案、`file:` 页面——同时对全部 web 方案来源（`http:`、`https:`、`blob:`、`data:`、
`about:`、`filesystem:`）保持严格的 Host 相等要求。该方案表就是远端通道契约用于判定
「页面是本机页面」的那张表
（[remote-one-time-landing-grant](../../implemented/architecture/2026-09-21-remote-one-time-landing-grant.zh.md)，
工单 #1682）。`isApplicationPageOrigin` 对外导出，便于自带围栏的路由族复用同一判定。

## Why it was rejected

该提案建立在一个未经验证的假设上：以为外壳会发出什么。桌面外壳用自己的 protocol handler
应答 `dsh-app://app/`：`/`、`/index.html`、`/assets/*`、`/favicon.svg` 与
`/manifest.webmanifest` 从打包前端读取，**其余每一条路径都由外壳自己重新发出**，走
`forwardWebRequest`。该转发会从页面请求里删掉 `host`、`origin`、`cookie` 与
`sec-fetch-site`，替换为启动时用 Host 启动链接换来的、与 authority 绑定的 `dsh-auth-*`
凭据；随后请求由 Node 的 `fetch` 发出——它只带 `sec-fetch-mode: cors`，完全不带 `Origin`
或 `sec-fetch-site`。

因此桌面上没有任何请求会呈现 `Origin: dsh-app://app`；接受应用方案来源对桌面毫无收益，
却对所有非 web 方案来源放宽了围栏。在该改动已被加载的运行中桌面宿主上实测：面板仍然报同样
的失败，而按外壳真实发出的头（回环 Host 加 `dsh-auth-*` cookie、无浏览器标记）请求
`GET /api/task-board/state` 仍答 `403 {"ok":false,"error":"forbidden"}`，同样头的
`GET /api/dsh-session-archive/inventory` 却答 200。

围栏恢复原状，面板则在真正的阻塞点上被解开——任务看板自己那道额外的标记门
（[the desktop shell's browser-auth cookie is the task board's page signal](../../implemented/bug-fix/2026-09-25-desktop-shell-browser-auth-marker.zh.md)）。

## Alternatives considered

提案自身的备选记录保留：「放宽为任何带浏览器标记的回环 socket 都放行」会丢掉普通 web 页面
赖以绑定同源的 Origin 项，而那正是 Origin 项唯一买到的东西。按主机名字面特判 `app` 只修好
今天这个外壳，下一个外壳又会失效；方案规则被选中，是因为应用方案的文档不可能由网络一方交付。
「让桌面页面走一个 Host 与自身来源一致的代理」属于 DSH 本体，不在本仓库掌握之内。

真正被采用的是被实测证明有效的那条：由自己那道门真正挡住面板的路由族，接受外壳确实会发出的
凭据。

## Evidence

从已安装应用读出：`dsh-desktop-host` 注册该方案（`protocol.handle`），把静态资源清单之外的
一切交给 `forwardWebRequest`，而该函数在转发用的 `fetch` 之前删掉 `origin` 与
`sec-fetch-site`。在同一运行时实测，Node 的 `fetch` 只发 `sec-fetch-mode: cors`，
`Origin` 与 `sec-fetch-site` 都不发。当初用来论证该提案的合成请求
（`curl -H 'Origin: dsh-app://app'`）并不描述外壳发出的任何请求。
