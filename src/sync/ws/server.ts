/* eslint-disable node/prefer-global/buffer */

import type { Server, ServerWebSocket } from 'bun'
import { deserializeUplink, serializeDownlink, UpdatePeersAction } from './protocol'

export interface WebSocketData {
  peerId: string
  roomId: string
}

export interface ServerOptions {
  port: number
  hostname: string
  manualDelay?: number
  onServerStart?: (info: { port: number, hostname: string }) => void
  onError?: (error: Error) => void
  onPeerJoin?: (peerId: string, roomId: string) => void
  onPeerLeave?: (peerId: string, roomId: string) => void
  onRoomEmpty?: (roomId: string) => void
}

export class WebSocketSignalingServer {
  private rooms = new Map<string, Map<string, ServerWebSocket<WebSocketData>>>()
  private server: Server | null = null
  private options: Required<ServerOptions>

  constructor(options: ServerOptions) {
    this.options = {
      manualDelay: 0,
      onServerStart: () => {},
      onError: () => {},
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      onRoomEmpty: () => {},
      ...options,
    }
  }

  start(): Server {
    const { port, hostname, manualDelay, onServerStart, onError, onPeerJoin, onPeerLeave, onRoomEmpty } = this.options

    this.server = Bun.serve({
      port,
      hostname,
      fetch: (req: Request, server: Server) => {
        const url = new URL(req.url)
        if (req.method === 'GET' && url.pathname === '/') {
          return new Response(
            `P2P Live Share WebSocket Signaling Server. ${this.rooms.size} active room(s).`,
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
      error: (error: Error) => {
        onError(error)
      },
      websocket: {
        open: (ws: ServerWebSocket<WebSocketData>) => {
          ws.binaryType = 'arraybuffer'
          const { roomId, peerId } = ws.data
          let roomClients = this.rooms.get(roomId)
          if (!roomClients) {
            this.rooms.set(roomId, roomClients = new Map())
          }
          roomClients.set(peerId, ws)
          this.sendUpdatePeers(roomId)
          onPeerJoin(peerId, roomId)
        },
        message: (ws: ServerWebSocket<WebSocketData>, message: string | Buffer) => {
          try {
            const uplink = deserializeUplink(message as string | ArrayBuffer)
            const { roomId, peerId: senderId } = ws.data

            const roomClients = this.rooms.get(roomId)
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
        close: (ws: ServerWebSocket<WebSocketData>) => {
          const { peerId, roomId } = ws.data
          const roomClients = this.rooms.get(roomId)
          if (peerId && roomClients) {
            roomClients.delete(peerId)
            if (roomClients.size === 0) {
              this.rooms.delete(roomId)
              onRoomEmpty(roomId)
            }
            else {
              this.sendUpdatePeers(roomId)
            }
            onPeerLeave(peerId, roomId)
          }
        },
      },
    })

    onServerStart({ port, hostname })
    return this.server
  }

  stop(): void {
    if (this.server) {
      this.server.stop()
      this.server = null
    }
  }

  getRooms(): Map<string, Map<string, ServerWebSocket<WebSocketData>>> {
    return this.rooms
  }

  getRoomCount(): number {
    return this.rooms.size
  }

  getPeersInRoom(roomId: string): string[] {
    const roomClients = this.rooms.get(roomId)
    return roomClients ? Array.from(roomClients.keys()) : []
  }

  private sendUpdatePeers(roomId: string): void {
    const roomClients = this.rooms.get(roomId)
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
}

export function createServer(options: ServerOptions): WebSocketSignalingServer {
  return new WebSocketSignalingServer(options)
}
