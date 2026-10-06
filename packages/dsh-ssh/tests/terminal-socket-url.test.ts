/**
 * Issue #1744: the terminal tab of the official DSH Desktop client always
 * failed while every HTTP surface of the same panel worked.
 *
 * The desktop shell serves its Web GUI from `dsh-app://app/`. Its protocol
 * handler forwards HTTP requests to the local Host, but a custom scheme cannot
 * carry a WebSocket upgrade, so the client deriving `ws://app/...` from
 * `location.host` could never connect. A first pass refused the socket on every
 * application scheme and told the user to use a browser; the fix is better
 * than that, because the shell already publishes the answer.
 *
 * The official transport hook (`__DSH_TRANSPORT__.streamBaseUrl`, written by
 * the shell before any boot entry runs) carries the loopback authority of the
 * Host it owns and already forwards every other request to. The resolver dials
 * the terminal there on an application-delivered page, and keeps the page's own
 * origin on a web page. The host-side fence is unchanged: the socket still
 * arrives over loopback and the shell still attaches its credential to the
 * handshake, so this moves the dial and widens no trust boundary.
 */
import { describe, expect, it } from 'vitest'
import { terminalSocketUrl } from '../src/client/api.ts'

describe('terminal socket URL per page transport (issue #1744)', () => {
  it('operator dials the page origin on a plain http Web GUI', () => {
    // Given a Web GUI served over http from loopback
    // When the terminal URL is built
    // Then it is a ws URL against that exact authority
    expect(terminalSocketUrl({ protocol: 'http:', host: '127.0.0.1:3080' }, '?alias=a&cols=80'))
      .toBe('ws://127.0.0.1:3080/api/dsh-ssh/terminal?alias=a&cols=80')
  })

  it('operator upgrades to wss on an https Web GUI', () => {
    // Given a Web GUI served over TLS
    // When the terminal URL is built
    // Then the socket is the secure variant, not a downgraded plain socket
    expect(terminalSocketUrl({ protocol: 'https:', host: 'dsh.example.com' }, '?session=s1'))
      .toBe('wss://dsh.example.com/api/dsh-ssh/terminal?session=s1')
  })

  it('operator connects the terminal inside the desktop app', () => {
    // Given the official desktop shell's page and the Host authority it published
    // When the terminal URL is built
    // Then the socket goes to that Host: the only origin a dsh-app page can upgrade
    expect(terminalSocketUrl({ protocol: 'dsh-app:', host: 'app' }, '?alias=a&cols=80', 'http://127.0.0.1:3080'))
      .toBe('ws://127.0.0.1:3080/api/dsh-ssh/terminal?alias=a&cols=80')
  })

  it('operator keeps a secure socket when the shell-owned Host is served over TLS', () => {
    // Given a shell whose Host base is https
    // When the terminal URL is built
    // Then the socket is wss, not a plaintext downgrade of a TLS Host
    expect(terminalSocketUrl({ protocol: 'dsh-app:', host: 'app' }, '?session=s1', 'https://127.0.0.1:3080'))
      .toBe('wss://127.0.0.1:3080/api/dsh-ssh/terminal?session=s1')
  })

  it('operator is refused when a shell page publishes no Host authority', () => {
    // Given an application-delivered page whose shell never published a base
    // When the terminal URL is built
    // Then there is nothing to dial, and the caller reports the actionable reason
    // instead of opening a socket that can only fail
    expect(terminalSocketUrl({ protocol: 'dsh-app:', host: 'app' }, '?alias=a')).toBeUndefined()
  })

  it('operator is refused on any application scheme without a base, not just the reported one', () => {
    // Given the same shape of page under a scheme nobody has seen yet
    // When the terminal URL is built
    // Then it is still refused, because only a shell that owns a Host can carry one
    for (const protocol of ['file:', 'app-shell:', 'dsh-app-beta:']) {
      expect(terminalSocketUrl({ protocol, host: 'app' }, '?alias=a'), protocol).toBeUndefined()
    }
  })

  it('operator is refused a base that is not a network Host authority', () => {
    // Given bases a socket could not legitimately be dialed against
    // When the terminal URL is built
    // Then each is refused rather than guessed at, so no unusable URL reaches the wire
    for (const base of ['', 'not a url', 'dsh-app://app', 'ftp://127.0.0.1:3080', 'http://', 'http://user:pw@127.0.0.1:3080']) {
      expect(terminalSocketUrl({ protocol: 'dsh-app:', host: 'app' }, '?alias=a', base), base).toBeUndefined()
    }
  })

  it('operator keeps a web page on its own origin even when it carries a transport hook', () => {
    // Given a web page that somehow carries a published base (the remote channel
    // grants ownsHost to a paired LAN page, which stays fenced behind pairing)
    // When the terminal URL is built
    // Then the socket stays on the page's own origin, so gated traffic is never
    // rerouted onto a host the page is not entitled to reach
    expect(terminalSocketUrl({ protocol: 'http:', host: '192.168.1.20:3080' }, '?alias=a', 'http://127.0.0.1:3080'))
      .toBe('ws://192.168.1.20:3080/api/dsh-ssh/terminal?alias=a')
  })

  it('operator keeps the network-minted documents on the web side', () => {
    // Given documents a network page can mint, which do reach a real host
    // When the terminal URL is built
    // Then they keep dialing their own authority, not the shell-owned base
    for (const protocol of ['http:', 'https:']) {
      expect(terminalSocketUrl({ protocol, host: 'example.com:3080' }, '', 'http://127.0.0.1:3080'), protocol)
        .toBe((protocol === 'https:' ? 'wss' : 'ws') + '://example.com:3080/api/dsh-ssh/terminal')
    }
  })
})
