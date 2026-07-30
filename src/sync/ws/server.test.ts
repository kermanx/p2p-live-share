import type { DownlinkMessageContent } from './protocol.ts'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { createServer } from './server.ts'

const hostId = 'host'
const guestId = 'guest'
const roomId = 'room'
const terminalOutput = '\x1B]3008;start=abc;type=shell\x1B\\\x1B[?2004h\x1B[32m$ \x1B[0m'

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
