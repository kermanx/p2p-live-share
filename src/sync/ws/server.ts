#!/usr/bin/env bun

/* eslint-disable node/prefer-global/buffer */
/* eslint-disable no-console */

import type { Server, ServerWebSocket } from 'bun'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { deserializeUplink, serializeDownlink, UpdatePeersAction } from './protocol'

if (typeof Bun === 'undefined') {
  // eslint-disable-next-line unicorn/prefer-type-error
  throw new Error('This server script must be run with Bun.')
}

interface WebSocketData {
  peerId: string
  roomId: string
}

const rooms = new Map<string, Map<string, ServerWebSocket<WebSocketData>>>()

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: 'string', short: 'p' },
    hostname: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    manualDelay: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
})

let port: number = 8080
if (values.port) {
  const parsed = Number.parseInt(values.port, 10)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`Invalid --port value: ${values.port}. Expected an integer 1-65535.`)
    process.exit(1)
  }
  port = parsed
}

const hostname = values.hostname || 'localhost'
const manualDelay = values.manualDelay ? Number.parseInt(values.manualDelay, 10) : 0

if (values.help) {
  // Minimal aligned usage info
  console.log(`p2p-live-share WebSocket signaling server\n\n`
    + `Usage:\n  bunx p2p-live-share-ws-server@latest [options]\n\n`
    + `Options:\n`
    + `  -p, --port <number>       Port to listen on (default: 8080)\n`
    + `      --hostname <host>     Hostname / interface to bind (default: localhost)\n`
    + `  -h, --help               Show this help message and exit\n\n`
    + `Examples:\n`
    + `  bunx p2p-live-share-ws-server@latest\n`
    + `  bunx p2p-live-share-ws-server@latest -p 9000\n`
    + `  bunx p2p-live-share-ws-server@latest --port 9000 --hostname 0.0.0.0\n`)
  process.exit(0)
}

console.info('Starting WebSocket server with Bun...')
console.info(`Listening on ws://${hostname}:${port}/`)

Bun.serve({
  port,
  hostname,
  fetch(req: Request, server: Server) {
    const url = new URL(req.url)
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(
        `P2P Live Share WebSocket Signaling Server. ${rooms.size} active room(s).`,
        {
          headers: { 'Content-Type': 'text/plain' },
        },
      )
    }

    const match = url.pathname.match(/^\/([\w-]+)\/([\w-]+)$/)

    if (match) {
      const [_, roomId, peerId] = match
      const upgraded = server.upgrade(req, {
        data: { roomId, peerId },
      })
      if (!upgraded) {
        return new Response('Upgrade failed', { status: 500 })
      }
      return
    }
    return new Response('Not found', { status: 404 })
  },
  error(error: Error) {
    console.error('Server error:', error)
  },
  websocket: {
    open(ws: ServerWebSocket<WebSocketData>) {
      ws.binaryType = 'arraybuffer'
      const { roomId, peerId } = ws.data
      let roomClients = rooms.get(roomId)
      if (!roomClients) {
        rooms.set(roomId, roomClients = new Map())
      }
      roomClients.set(peerId, ws)
      sendUpdatePeers(roomId)
      console.info(`Peer ${peerId} joined room ${roomId}`)
    },
    message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
      try {
        const uplink = deserializeUplink(message as string | ArrayBuffer)
        const { roomId, peerId: senderId } = ws.data

        const roomClients = rooms.get(roomId)
        if (!roomClients) {
          console.error(`Room ${roomId} not found. Closing connection.`)
          ws.close()
          return
        }

        const downlinkPayload = {
          action: uplink.action,
          data: uplink.data,
          peerId: senderId,
          metadata: uplink.metadata,
        }
        const downlinkMessage = serializeDownlink(downlinkPayload)

        const targets = uplink.targetPeers
          ? (Array.isArray(uplink.targetPeers) ? uplink.targetPeers : [uplink.targetPeers])
              .map(id => roomClients.get(id))
          : Array.from(roomClients.values())

        targets.forEach((client) => {
          if (client && client !== ws) {
            if (manualDelay) {
              setTimeout(() => {
                client.send(downlinkMessage)
              }, manualDelay)
            }
            else {
              client.send(downlinkMessage)
            }
          }
        })
      }
      catch (error) {
        console.error('Failed to process message:', error)
      }
    },
    close(ws: ServerWebSocket<WebSocketData>) {
      const { peerId, roomId } = ws.data
      const roomClients = rooms.get(roomId)
      if (peerId && roomClients) {
        roomClients.delete(peerId)
        if (roomClients.size === 0) {
          rooms.delete(roomId)
          console.info(`Room ${roomId} is now empty and has been removed.`)
        }
        else {
          sendUpdatePeers(roomId)
        }
        console.info(`Peer ${peerId} left room ${roomId}`)
      }
    },
  },
})

function sendUpdatePeers(roomId: string) {
  const roomClients = rooms.get(roomId)
  if (roomClients) {
    const peerIds = Array.from(roomClients.keys())
    const updateMessage = serializeDownlink({
      action: UpdatePeersAction,
      data: peerIds,
      peerId: 'server',
    })
    roomClients.forEach((client) => {
      client.send(updateMessage)
    })
  }
}
