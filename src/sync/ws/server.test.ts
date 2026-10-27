import type { DownlinkMessageContent } from './protocol.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { WebSocket } from 'ws'
import { createServer } from './server.ts'

const hostId = 'host'
const guestId = 'guest'
const roomId = 'room'
const terminalOutput = '\x1B]3008;start=abc;type=shell\x1B\\\x1B[?2004h\x1B[32m$ \x1B[0m'

describe('WebSocketSignalingServer shutdown', () => {
  for (const hostMode of [true, false]) {
    it(`disconnects all guests when stopping a ${hostMode ? 'host' : 'relay'} server`, async (t) => {
      const server = createServer({
        port: 0,
        hostname: '127.0.0.1',
        hostMode: hostMode ? { roomId, hostId, onHostMessage: () => {} } : undefined,
      })
      const clients: WebSocket[] = []
      t.after(() => {
        clients.forEach(client => client.terminate())
        server.stop()
      })
      const httpServer = server.start()
      await once(httpServer, 'listening')
      const address = httpServer.address()
      assert.ok(address && typeof address === 'object')

      for (const id of ['guest-1', 'guest-2']) {
        const client = new WebSocket(`ws://127.0.0.1:${address.port}/${roomId}/${id}`)
        clients.push(client)
        await once(client, 'open')
      }

      const signal = AbortSignal.timeout(1000)
      const closed = clients.map(client => once(client, 'close', { signal }))
      const serverClosed = once(httpServer, 'close', { signal })
      server.stop()
      server.stop()

      const [closedClients] = await Promise.all([Promise.all(closed), serverClosed])
      for (const [code] of closedClients) {
        assert.equal(code, 1001)
      }
    })
  }
})

describe('WebSocketSignalingServer host routing', () => {
  function setup() {
    const hostMessages: DownlinkMessageContent[] = []
    const server = createServer({
      port: 0,
      hostname: '127.0.0.1',
      hostMode: {
        roomId,
        hostId,
        onHostMessage: message => hostMessages.push(message),
      },
    })
    return { hostMessages, server }
  }

  it('does not deliver host broadcasts back to the host', () => {
    const { hostMessages, server } = setup()

    server.handleMessage({ action: 'terminal', data: terminalOutput }, roomId, hostId)

    assert.deepEqual(hostMessages, [])
  })

  it('does not deliver explicitly self-targeted host messages', () => {
    const { hostMessages, server } = setup()

    server.handleMessage({ action: 'terminal', data: terminalOutput, targetPeers: hostId }, roomId, hostId)

    assert.deepEqual(hostMessages, [])
  })

  it('delivers guest broadcasts to the host without changing terminal data', () => {
    const { hostMessages, server } = setup()

    server.handleMessage({ action: 'terminal', data: terminalOutput }, roomId, guestId)

    assert.deepEqual(hostMessages, [{
      action: 'terminal',
      data: terminalOutput,
      peerId: guestId,
      metadata: undefined,
    }])
  })

  it('delivers guest messages targeted at the host', () => {
    const { hostMessages, server } = setup()

    server.handleMessage({ action: 'terminal', data: 'ls\r', targetPeers: hostId }, roomId, guestId)

    assert.deepEqual(hostMessages, [{
      action: 'terminal',
      data: 'ls\r',
      peerId: guestId,
      metadata: undefined,
    }])
  })
})
