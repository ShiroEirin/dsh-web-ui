# Agent Note: The desktop shell's browser-auth cookie is the task board's page signal

Status: implemented

## Problem

`dsh-task-board` is the only family route family whose fence adds a browser signal
on top of the shared loopback guard: `browserSameOriginMarker` accepted
`sec-fetch-site: same-origin` or any `Origin` header, and refused every request
that carried neither. The eight sibling families - plugin manager, market, SSH,
skill explorer, session archive, usage, git graph, update - fence on
`isLoopbackRequest` alone.

The official DSH Desktop shell serves the Web GUI from `dsh-app://app/` and
answers that scheme with its own protocol handler: `/`, `/index.html`,
`/assets/*`, `/favicon.svg` and `/manifest.webmanifest` are read from the
packaged frontend, and **every other path is re-issued by the shell itself**
through `forwardWebRequest`. That forward deletes `host`, `origin`, `cookie` and
`sec-fetch-site` from the page's request, substitutes the authority-bound
`dsh-auth-*` credential it exchanged for the launch URL of the Host at startup,
and performs the request with Node's `fetch` - which sends `sec-fetch-mode: cors`
and no `Origin` or `sec-fetch-site` at all. The board's own
`/api/task-board/state` fetch therefore arrives marker-less:

    Host: 127.0.0.1:19387
    Cookie: dsh-auth-<authority hash>=v1....
    sec-fetch-mode: cors

`browserSameOriginMarker` returned false for it, the guard answered
`403 {"ok":false,"error":"forbidden"}`, and the panel rendered its
`board.hostError.unauthorized` copy ('登录状态已失效，请刷新页面后重试') - on the
desktop only, while the same page over an http origin worked.

Measured on the running desktop host: a marker-less `GET /api/task-board/state`
answered 403 while `GET /api/dsh-session-archive/inventory` - same socket, same
missing markers, sibling fence - answered 200. That asymmetry, not the loopback
guard, was the defect.

## Decision

The task board's marker also accepts a request whose `Cookie` header carries the
harness browser-auth cookie: the `dsh-auth-` prefix `@deepseek-ai/dsh-client-connection`
mints for this authority. Only an application on this machine can hold it - the
desktop shell never lets it into the cookie jar of the page, and the cookie is
`HttpOnly; SameSite=Strict`, so a cross-site page can neither read nor attach it.

The family already made this trust decision once:
`packages/dsh-remote-web-ui/src/loopback-proxy.ts` re-issues paired-device
traffic to 127.0.0.1 with a synthetic `sec-fetch-site: same-origin` **and** the
credential of the process itself, so that tripwire-bearing sibling routes accept
it ([remote web-ui trust and resource fixes](2026-09-21-remote-web-ui-trust-and-resource-fixes.md)).
The desktop shell redeems the same credential but does not synthesize the marker;
accepting the credential is that decision re-expressed against what the shell
actually sends.

The marker stays a tripwire, not an authority, exactly as its docstring says. A
web-page `Origin` still has to equal the Host header, `sec-fetch-site: cross-site`
is still refused by `isLoopbackRequest` before any origin is read, and a
marker-less request without the credential - a bare local tool - is still refused.

## Testing

`packages/dsh-task-board/tests/host-routes.spec.ts` runs the real route stack on a
real HTTP server. The new case pins the desktop shell's forward: a `dsh-auth-*`
cookie with no browser markers answers 200 on `GET /state` and on `POST /action`,
the same cookie with `sec-fetch-site: cross-site` answers 403, and both a
marker-less request and a request carrying an unrelated cookie answer 403. The
case fails against the pre-change fence and passes after it; the typecheck, build
and full suite (558 passing, 1 skipped) of the package are green.

## Alternatives considered

Dropping the extra marker so the task board's fence matches its eight siblings was
rejected: the marker is a documented, deliberately kept property ('a bare local
curl cannot exercise the agent control plane'), and removing it would widen the
gap between the tripwire and what the docstring promises for every client just to
admit one.

Accepting any `Cookie` header was rejected as too loose. The desktop shell always
attaches the credential of the Host, but so does an ordinary browser session, and
the named credential is the part of that forward the repository's own precedent
already treats as the identity: the `dsh-auth-` prefix is an authority-bound
value rather than 'some cookie'.

Relying on an application-scheme Origin allowance at the shared fence was
rejected, and that proposal is recorded as declined
([the desktop shell's own scheme at the loopback route fence - rejected](../../rejected/bug-fix/2026-09-25-desktop-shell-origin-route-fence.md)):
it assumed the host-route fetches of the shell carry `Origin: dsh-app://app`,
while the shell deletes `origin` before forwarding and Node's `fetch` adds none,
so no desktop request presents that origin. It bought nothing for the desktop
and widened the fence for every non-web scheme, so the fence keeps its previous
shape.

Teaching the shell to synthesize `sec-fetch-site: same-origin` the way
`loopback-proxy.ts` does was rejected as out of this repository's hands: the shell
is DSH itself, and a host-side route family cannot require a future shell build to
change.

## Consequences

The board works in the DSH Desktop application without touching any other package,
and keeps its marker for every other client: an authenticated reverse proxy, a
same-origin http page and the paired-device remote channel still pass, while a
marker-less local tool still fails. The coupling is now explicit in two places
that must move together - the `dsh-auth-` prefix here and in
`dsh-remote-web-ui/src/inner-auth.ts` - the same shape the repository already
carries for `WEB_PAGE_SCHEMES`.

A local process that writes a `dsh-auth-*` cookie into its request passes the
marker, exactly as a local process forging an `Origin` header already did. The
socket, Host and origin-equality checks remain the authority, so who may drive the
board does not change.
