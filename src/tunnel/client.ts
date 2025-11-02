import type { EffectScope } from 'reactive-vscode'
import type { Connection } from '../sync/connection'
import type { ServerInfo, SocketMeta } from './types'
import net from 'node:net'
import { nanoid } from 'nanoid'
import { effectScope, onScopeDispose, readonly, shallowReactive } from 'reactive-vscode'
import { SocketEventType } from './types'

export function useTunnelClients(connection: Connection) {
  const [send, recv] = connection.makeAction<Uint8Array | null, SocketMeta>('tunnel')
  const receivers = new Map<string, (data: Uint8Array | null, metadata: SocketMeta) => void>()
  recv((data, _peerId, metadata) => {
    const receiver = receivers.get(metadata!.linkId)
    receiver?.(data, metadata!)
  })

  function useClient(
    peerId: string,
    linkId: string,
    port: number,
    host: string,
  ) {
    receivers.set(linkId, (data, { socketId, event }) => {
      const socket = sockets.get(socketId)
      if (!socket) {
        console.warn('Socket not found:', socketId)
        return
      }
      if (event === SocketEventType.Connect) {
        console.warn('Client should not receive Connect event')
      }
      else if (event === SocketEventType.Data) {
        socket.write(data!)
      }
      else if (event === SocketEventType.End) {
        socket.end()
      }
      else if (event === SocketEventType.Close) {
        socket.destroy()
        sockets.delete(socketId)
      }
    })

    const sockets = new Map<string, net.Socket>()
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      const socketId = nanoid(7)
      sockets.set(socketId, socket)
      send(null, peerId, { linkId, socketId, event: SocketEventType.Connect })
      socket.on('data', data => send(data, peerId, { linkId, socketId, event: SocketEventType.Data }))
      socket.on('end', () => send(null, peerId, { linkId, socketId, event: SocketEventType.End }))
      socket.on('close', () => send(null, peerId, { linkId, socketId, event: SocketEventType.Close }))
      socket.on('error', err => console.error('Tunnel client error:', err))
    })
    const ready = new Promise<void>((resolve) => {
      server.listen(port, host, resolve)
    })

    onScopeDispose(() => {
      for (const socket of sockets.values()) {
        try {
          socket.end()
          socket.destroy()
        }
        catch {}
      }
      server.close()
      receivers.delete(linkId)
    })

    return {
      ready,
    }
  }

  const clients = shallowReactive(new Map<string, {
    scope: EffectScope
    host: string
    port: number
  }>())
  onScopeDispose(() => {
    for (const { scope } of clients.values()) {
      scope.stop()
    }
  })

  return {
    connectedServers: readonly(clients),
    async createClient(info: ServerInfo, targetPort: number, targetHost: string) {
      const scope = effectScope(true)
      clients.set(info.serverId, { scope, host: targetHost, port: targetPort })
      await scope.run(() => {
        const linkId = `${info.serverId}/${connection.selfId}`
        const client = useClient(info.peerId, linkId, targetPort, targetHost)
        return client.ready
      })
    },
    closeClient(serverId: string) {
      clients.get(serverId)?.scope.stop()
      clients.delete(serverId)
    },
  }
}
