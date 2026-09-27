# Agent Note: The desktop shell's own scheme at the loopback route fence - rejected

Status: rejected — the desktop shell deletes `origin` before forwarding, so no host-route fetch ever presents `dsh-app://app`; the panel was blocked by the task board's own browser-markers gate instead

## Problem

The family's host route families fence every request on a loopback socket, a
loopback Host header, and browser same-origin markers
(`shared/host/loopback.ts`). Its Origin check required the Origin host to equal
the Host header exactly. The user-visible report was the task board panel
answering its unauthorized message ("Host 操作失败: 登录状态已失效, 请刷新页面后重试")
in the official DSH Desktop application only, while the same page over an http
origin worked.

## Proposal (declined)

Accept an Origin on a scheme no network transport serves - the desktop shell's
`dsh-app:`, another shell's own scheme, a `file:` page - while keeping the exact
Host equality requirement for every web-scheme origin (`http:`, `https:`,
`blob:`, `data:`, `about:`, `filesystem:`). The scheme table is the one the
remote-channel contract already applies to decide a page is local
([remote-one-time-landing-grant](../../implemented/architecture/2026-09-21-remote-one-time-landing-grant.md),
issue #1682). `isApplicationPageOrigin` would be exported so a route family with
its own fence could reuse the verdict.

## Why it was rejected

The proposal rested on an unverified assumption about what the shell sends. The
desktop shell answers `dsh-app://app/` with its own protocol handler: `/`,
`/index.html`, `/assets/*`, `/favicon.svg` and `/manifest.webmanifest` are read
from the packaged frontend, and **every other path is re-issued by the shell
itself** through `forwardWebRequest`. That forward deletes `host`, `origin`,
`cookie` and `sec-fetch-site` from the page's request and substitutes the
authority-bound `dsh-auth-*` credential it redeemed for the launch URL of the
Host; the request then runs through Node's `fetch`, which sends
`sec-fetch-mode: cors` and no `Origin` or `sec-fetch-site` at all.

So no desktop request ever presents `Origin: dsh-app://app`, and accepting
application-scheme origins bought nothing for the desktop while widening the
fence for every non-web scheme. Measured on the running desktop host with this
change already loaded: the panel still reported the same failure, and
`GET /api/task-board/state` still answered `403 {"ok":false,"error":"forbidden"}`
for the header set the shell really produces (loopback Host plus a `dsh-auth-*`
cookie, no browser markers), while `GET /api/dsh-session-archive/inventory` with
that same set answered 200.

The fence keeps its previous shape and the panel is unblocked where the blocker
actually is - the task board's own extra marker
([the desktop shell's browser-auth cookie is the task board's page signal](../../implemented/bug-fix/2026-09-25-desktop-shell-browser-auth-marker.md)).

## Alternatives considered

The proposal's own alternatives stay recorded. Relaxing the fence to "any
loopback socket with any browser marker" would drop the cross-origin binding
ordinary web pages rely on, which is the only thing the Origin term buys.
Special-casing the literal hostname `app` fixes today's shell and breaks on the
next one; the scheme rule was preferred because an application-scheme document
cannot be delivered by a network party. Making the desktop page request through
a proxy whose Host matches its own origin belongs to DSH itself, not this
repository.

The alternative that was taken instead is the one measured to work: the route
family whose own gate actually refused the panel accepts the credential the
shell does send.

## Evidence

Read from the installed application: `dsh-desktop-host` registers the scheme
(`protocol.handle`), routes everything outside its static asset list through
`forwardWebRequest`, and that function deletes `origin` and `sec-fetch-site`
before the forwarded `fetch`. Measured in the same runtime, Node's `fetch` sends
`sec-fetch-mode: cors` and neither `Origin` nor `sec-fetch-site`. The synthetic
request the proposal was justified with (`curl -H 'Origin: dsh-app://app'`) does
not describe any request the shell makes.
