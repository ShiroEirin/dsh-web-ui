/**
 * Host terminal session registry: the shell outlives the view that opened it.
 *
 * These cases drive the registry directly with a fake shell and fake sockets,
 * so the detach/reattach contract, the scrollback replay, the explicit close
 * and the idle reap are pinned without a real ssh2 server or a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { TerminalSessionRegistry } from '../src/engine/terminal-sessions.ts'
import type { ShellSession } from '../src/engine/pty.ts'

/** Frames a socket received, in order. */
type Sent = Array<Record<string, unknown>>

/** A socket stand-in recording what the host sent it. */
function fakeSocket() {
  const sent: Sent = []
  const handlers: Record<string, (arg?: unknown) => void> = {}
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (text: string) => { sent.push(JSON.parse(text) as Record<string, unknown>) },
    close: () => { handlers.close?.() },
    on: (event: string, handler: (arg?: unknown) => void) => { handlers[event] = handler },
  }
  return {
    socket: socket as unknown as WebSocket,
    sent,
    /** Test hook: deliver a client frame as if the browser sent it. */
    deliver: (frame: Record<string, unknown>) => { handlers.message?.(JSON.stringify(frame)) },
  }
}

/** A fake PTY shell whose output the test drives. */
function fakeShell() {
  const session = {
    onData: undefined as ((data: Buffer) => void) | undefined,
    onExit: undefined as ((code: number | null, error?: string) => void) | undefined,
    inputs: [] as string[],
    sizes: [] as Array<{ cols: number; rows: number }>,
    closed: false,
    paused: 0,
    resumed: 0,
    send(data: string) { session.inputs.push(data) },
    resize(cols: number, rows: number) { session.sizes.push({ cols, rows }) },
    close() { session.closed = true },
    pause() { session.paused += 1 },
    resume() { session.resumed += 1 },
  }
  return session
}

/** The ready frame's session id, or undefined. */
function sessionIdOf(sent: Sent): string | undefined {
  const ready = sent.find(frame => frame.type === 'ready')
  return ready?.sessionId as string | undefined
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('host terminal sessions', () => {
  it('operator connecting gets a session id and later reattaches to the same shell', async () => {
    // Given a registry whose first socket opened a shell
    const shell = fakeShell()
    const registry = new TerminalSessionRegistry({ openShell: async () => shell as unknown as ShellSession })
    const first = fakeSocket()
    await registry.open(first.socket, 'web', { cols: 80, rows: 24 })
    const id = sessionIdOf(first.sent)
    // The id is the host's reattach handle: 9 random bytes rendered as hex.
    expect(id).toMatch(/^[0-9a-f]{18}$/)
    expect(first.sent.some(frame => frame.type === 'ready')).toBe(true)

    // When the remote prints and the view detaches
    shell.onData?.(Buffer.from('hello'))
    first.deliver({ type: 'detach' })

    // Then the shell is still alive, and a new socket attaching replays the
    // scrollback and ready frame for the SAME session id
    expect(shell.closed).toBe(false)
    const second = fakeSocket()
    const attached = registry.attach(second.socket, id as string, { cols: 100, rows: 30 })
    expect(attached).toBe(true)
    expect(sessionIdOf(second.sent)).toBe(id)
    expect(second.sent.some(frame => frame.type === 'output' && frame.data === 'hello')).toBe(true)
    expect(registry.size()).toBe(1)
  })

  it('operator disconnecting ends the remote shell outright', async () => {
    // Given a connected session
    const shell = fakeShell()
    const registry = new TerminalSessionRegistry({ openShell: async () => shell as unknown as ShellSession })
    const { socket, deliver } = fakeSocket()
    await registry.open(socket, 'web', { cols: 80, rows: 24 })

    // When the view sends the explicit close frame
    deliver({ type: 'close' })

    // Then the shell is torn down and the session is gone
    expect(shell.closed).toBe(true)
    expect(registry.size()).toBe(0)
  })

  it('operator returning later still finds a session that was only detached', async () => {
    // Given a session whose view detached
    const shell = fakeShell()
    const registry = new TerminalSessionRegistry({ openShell: async () => shell as unknown as ShellSession, idleMs: 1000 })
    const { socket, deliver } = fakeSocket()
    await registry.open(socket, 'web', { cols: 80, rows: 24 })
    deliver({ type: 'detach' })

    // When the idle window passes without anyone attaching
    vi.advanceTimersByTime(1000)

    // Then the shell is reaped instead of leaking for the host's lifetime
    expect(shell.closed).toBe(true)
    expect(registry.size()).toBe(0)
  })

  it('operator sees the final screen after the remote shell exits', async () => {
    // Given a connected session
    const shell = fakeShell()
    const registry = new TerminalSessionRegistry({ openShell: async () => shell as unknown as ShellSession, exitGraceMs: 500 })
    const first = fakeSocket()
    await registry.open(first.socket, 'web', { cols: 80, rows: 24 })
    const id = sessionIdOf(first.sent) as string

    // When the remote exits
    shell.onData?.(Buffer.from('bye'))
    shell.onExit?.(0)

    // Then the attached socket is told, and a reattach before the grace window
    // still replays the last output plus the exit frame
    expect(first.sent.some(frame => frame.type === 'exit' && frame.code === 0)).toBe(true)
    const second = fakeSocket()
    expect(registry.attach(second.socket, id, { cols: 80, rows: 24 })).toBe(true)
    expect(second.sent.some(frame => frame.type === 'output' && frame.data === 'bye')).toBe(true)
    expect(second.sent.some(frame => frame.type === 'exit')).toBe(true)

    // And once that view leaves too, the grace window reclaims the record
    second.deliver({ type: 'detach' })
    vi.advanceTimersByTime(500)
    expect(registry.size()).toBe(0)
  })

  it('operator attaching an expired id is told instead of getting a blank terminal', () => {
    // Given a registry with no such session
    const registry = new TerminalSessionRegistry({ openShell: async () => fakeShell() as unknown as ShellSession })
    const { socket } = fakeSocket()

    // When a view attaches with a stale id
    // Then the host refuses it, so the view can fall back to a fresh connect
    expect(registry.attach(socket, 'deadbeef', { cols: 80, rows: 24 })).toBe(false)
  })
})
