# Agent Note: A running tunnel is supervised by its public URL, not only its process

Status: implemented

## Problem

The auto tunnel's failure judgement covered two shapes only: the minted URL
never arrived inside the timeout, and the cloudflared process exited. A third
shape has no signal in either: the connector loses its Cloudflare edge
registration while the process — and its metrics port — stays alive. The
hostname then stops resolving, the manager keeps reporting `running`, and the
stable-hostname relay keeps forwarding paired phones to that dead address, so
the phone hits Cloudflare 530 / Error 1016 ("Origin DNS error") instead of the
relay's own offline page. Measured in issue #1723 in a real long-running
deployment: `GET /api/pair/status` reported
`{"tunnel":{"state":"running","url":"https://…trycloudflare.com"}}` while the
same second's `GET 127.0.0.1:20241/ready` answered
`{"status":503,"readyConnections":0,…}`, the minted host was NXDOMAIN, and the
fixed relay origin answered 530. The state persisted for over four hours with
no self-healing path; only closing and reopening the auto tunnel, or restarting
`dsh web`, minted a working URL.

The manager's own comment already named this failure shape for the spawn
decision (`readyConnections: 0 forever`, which `--protocol http2` avoids), but
nothing checked it while a tunnel ran.

## Decision

`TunnelManager` supervises readiness, not just process liveness. Once a tunnel
reports its URL, a watchdog probes that public URL every
`healthCheckIntervalMs` (default 60 s, `0` disables the watchdog) and
`healthCheckFailures` consecutive failures (default 2) call the existing
`fail()` path with "the tunnel stopped answering on its public URL". That path
is unchanged: it stops the handle, clears the phase to `failed`, and schedules
the ordinary exponential-backoff restart, so a fresh tunnel is minted and
`onUrl` fires again — which is what makes `announceRelay` re-register the
stable relay against the new URL. The panel and `/api/pair/status` therefore
report a real `failed`/`starting` transition instead of a stale `running`.

`probeTunnelUrl(url, timeoutMs)` is the default probe: a GET to the tunnel's
public URL from the host, where any HTTP answer below 500 counts as alive —
an unpaired harness answers 401/403, a normal round trip — while a DNS
failure, a refused or hung connection, and a Cloudflare 5xx (530 "Origin DNS
error", 1033) count as dead. It resolves `false` instead of rejecting, because
the watchdog reads a rejection as death and a local probe error must never
recycle a working tunnel.

The probe is deliberately the *public* URL rather than cloudflared's local
`/ready` endpoint: the endpoint is not exposed by the cloudflared package's
handle (its metrics port is chosen by the binary), and the public URL is the
address the phone actually uses, so a single measurement covers DNS,
edge registration, and origin reachability. The interval is generous relative
to the failure it detects: this is a watchdog against a silently dead tunnel,
not a load balancer health check, and one probe per minute keeps the probe
itself invisible in the tunnel's own request counters.

All new seams — `probe`, `healthCheckIntervalMs`, `healthCheckFailures`,
`probeTimeoutMs` — are injectable, so the watchdog is covered without a
network or a real binary.

## Alternatives considered

Probing cloudflared's own `/ready` (or `readyConnections` from its metrics)
was rejected because the manager owns neither the port nor the client: the
cloudflared package's `Tunnel` handle exposes no readiness face, and issue
#1445 already fixed the QUIC variant of this failure at spawn time with
`--protocol http2`. The public URL is the stronger signal anyway — it fails
exactly when a phone would fail.

Treating a single failed probe as death was rejected: a transient DNS or
network hiccup on the host would recycle a healthy tunnel and churn the phone's
origin, which is the cost the reconnect-grace work (issue #1547) already tries
to avoid. Two consecutive failures with the default 60 s interval delay a
genuine verdict by at most one minute.

Leaving the judgement to the relay (for example a Workers-side probe that drops
the mapping) was rejected as out of this repository's hands: the relay cannot
detect a dead origin reliably — that is what the 1016 page is — and the plugin
must self-heal without the relay being reachable.

Also rejected: making the probe a setting. The failure it detects is never
user-intended, the default interval costs one request per minute, and a
disabled watchdog restores exactly the #1723 behavior.

## Consequences

A long-running deployment now recovers from a silently dead tunnel by itself:
within about two probe intervals the phase leaves `running`, the backoff
restart mints a new URL, and the relay is re-registered — the phone's fixed
origin answers the normal `401` instead of Cloudflare 1016.

The watchdog also observes the gap the relay's offline page was designed for:
while the tunnel is `failed`/`starting`, the plugin reports that state and the
relay keeps its last mapping until a new URL is announced.

Costs: one request per minute per running tunnel to its own public URL, and at
most one extra minute before a dead tunnel is declared failed. A tunnel whose
public URL is reachable from the internet but refuses this host's probe (for
example an edge that blocks the deployment's egress IP) would be recycled in a
loop; no such case is known, and the probe reads the same path the phone uses.

## Testing

`packages/dsh-remote-web-ui/tests/tunnel.spec.ts` pins the watchdog against
injected seams: a healthy URL is probed and never restarts; two consecutive
failures fail the attempt with "the tunnel stopped answering on its public URL",
stop the old handle, and restart with backoff into a new URL surfaced through
`onUrl`; a success clears the failure counter so a transient miss does not
recycle the tunnel; `stop()` cancels a pending probe; and a probe that resolves
after the tunnel was replaced for a new target does not judge the fresh tunnel.
`probeTunnelUrl` itself is covered against real loopback servers — an
unauthenticated `401` counts as alive, `530` counts as dead, and a refused
connection resolves `false` rather than rejecting. The four manager cases fail
against the pre-change manager (the watchdog absent) and pass after it.
