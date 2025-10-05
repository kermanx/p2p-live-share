import type { EffectScope } from 'reactive-vscode'
import type * as Y from 'yjs'
import type { Connection } from '../sync/connection'
import type { ServerInfo, SocketData, SocketEventMeta, SocketMeta } from './types'
import net from 'node:net'
import { nanoid } from 'nanoid'
import { effectScope, onScopeDispose } from 'reactive-vscode'
import { window } from 'vscode'
import { useSyncController } from '../sync/controller'
import { SocketEventType } from './types'

export function useTunnelServers(connection: Connection, serversMap: Y.Map<ServerInfo>) {
  const [send_, recv] = connection.makeAction<SocketData, SocketMeta>('tunnel')
  const receivers = new Map<string, (data: SocketData, metadata: SocketMeta) => void>()
  recv((data, _peerId, metadata) => {
    const receiver = receivers.get(metadata!.linkId)
    if (!receiver) {
      console.warn('Receiver not found for linkId:', metadata!.linkId)
      return
    }
    receiver(data, metadata!)
  })

  function useServer(
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
        if (event === SocketEventType.Connect) {
          connect(socketId)
          return
        }

        const socket = sockets.get(socketId)
        if (!socket) {
          console.warn('Socket not found:', socketId)
          return
        }
        if (event === SocketEventType.Data) {
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
    function connect(socketId: string) {
      const socket = net.connect(port, host, () => {})
      sockets.set(socketId, socket)
      socket.on('data', data => send(data, { socketId, event: SocketEventType.Data }))
      socket.on('end', () => send(null, { socketId, event: SocketEventType.End }))
      socket.on('close', () => send(null, { socketId, event: SocketEventType.Close }))
    }

    onScopeDispose(() => {
      for (const socket of sockets.values()) {
        socket.end()
        socket.destroy()
      }
      receivers.delete(linkId)
      cleanup()
    })
  }

  const scopes = new Map<string, EffectScope>()
  onScopeDispose(() => {
    for (const scope of scopes.values()) {
      scope.stop()
    }
  })

  return {
    createTunnel(port: number, host: string) {
      const serverId = nanoid(9)
      serversMap.set(serverId, {
        serverId,
        peerId: connection.selfId,
        name: `Server ${serverId}`,
        host,
        port,
        createdAt: Date.now(),
      })
      return serverId
    },
    closeTunnel(serverId: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        window.showWarningMessage(`Server not found: ${serverId}`)
        return
      }
      if (info.peerId !== connection.selfId) {
        window.showWarningMessage(`You are not the owner of server ${serverId}`)
        return
      }
      serversMap.delete(serverId)
      const linkIdPrefix = `${serverId}/`
      for (const linkId of Array.from(scopes.keys())) {
        if (linkId.startsWith(linkIdPrefix)) {
          const scope = scopes.get(linkId)!
          scope.stop()
          scopes.delete(linkId)
        }
      }
    },
    async linkTunnel(serverId: string, peerId: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        throw new Error(`Server not found: ${serverId}`)
      }
      if (info.peerId !== connection.selfId) {
        throw new Error(`Server ${serverId} is not owned by ${connection.selfId}`)
      }
      const linkId = `${serverId}/${peerId}`
      const scope = effectScope(true)
      scopes.set(linkId, scope)
      scope.run(() => {
        useServer(peerId, linkId, info.port, info.host)
      })
      return linkId
    },
  }
}
