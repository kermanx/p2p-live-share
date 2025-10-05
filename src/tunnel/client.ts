import type { EffectScope } from 'reactive-vscode'
import type { Connection } from '../sync/connection'
import type { ServerInfo, SocketData, SocketEventMeta, SocketMeta } from './types'
import net from 'node:net'
import { nanoid } from 'nanoid'
import { effectScope, onScopeDispose, readonly, shallowReactive } from 'reactive-vscode'
import { useSyncController } from '../sync/controller'
import { SocketEventType } from './types'

export function useTunnelClients(connection: Connection) {
  const [send_, recv] = connection.makeAction<SocketData, SocketMeta>('tunnel')
  const receivers = new Map<string, (data: SocketData, metadata: SocketMeta) => void>()
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
    const { send, recv, cleanup } = useSyncController<SocketData, SocketEventMeta>(
      (data, metadata) => {
        send_(data, peerId, {
          ...metadata,
          linkId,
        })
      },
      (data, { socketId, event }) => {
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
      },
    )
    receivers.set(linkId, recv)

    const sockets = new Map<string, net.Socket>()
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      const socketId = nanoid(7)
      sockets.set(socketId, socket)
      send(null, { socketId, event: SocketEventType.Connect })
      socket.on('data', data => send(data, { socketId, event: SocketEventType.Data }))
      socket.on('end', () => send(null, { socketId, event: SocketEventType.End }))
      socket.on('close', () => send(null, { socketId, event: SocketEventType.Close }))
    })

    const ready = new Promise<void>((resolve) => {
      server.listen(port, host, resolve)
    })
    onScopeDispose(() => {
      server.close()
      receivers.delete(linkId)
      cleanup()
    })

    return {
      ready,
    }
  }

  const clients = shallowReactive(new Map<string, {
    scope: EffectScope
    serverId: string
  }>())
  onScopeDispose(() => {
    for (const { scope } of clients.values()) {
      scope.stop()
    }
  })

  return {
    clientsMap: readonly(clients),
    async createClient(info: ServerInfo, targetPort: number, targetHost: string) {
      const linkId = `${info.serverId}/${connection.selfId}`
      const scope = effectScope(true)
      clients.set(linkId, { scope, serverId: info.serverId })
      await scope.run(() => {
        const client = useClient(info.peerId, linkId, targetPort, targetHost)
        return client.ready
      })
    },
  }
}
