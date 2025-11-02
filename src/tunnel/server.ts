import type { EffectScope } from 'reactive-vscode'
import type * as Y from 'yjs'
import type { Connection } from '../sync/connection'
import type { ServerInfo, SocketMeta } from './types'
import net from 'node:net'
import { nanoid } from 'nanoid'
import { effectScope, onScopeDispose, readonly, shallowReactive } from 'reactive-vscode'
import { window } from 'vscode'
import { SocketEventType } from './types'

export function useTunnelServers(connection: Connection, serversMap: Y.Map<ServerInfo>) {
  const [send, recv] = connection.makeAction<Uint8Array | null, SocketMeta>('tunnel')
  const receivers = new Map<string, (data: Uint8Array | null, metadata: SocketMeta) => void>()
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
    receivers.set(linkId, (data, { socketId, event }) => {
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
    })

    const sockets = new Map<string, net.Socket>()
    function connect(socketId: string) {
      const socket = net.connect(port, host, () => {})
      sockets.set(socketId, socket)
      socket.on('data', data => send(data, peerId, { linkId, socketId, event: SocketEventType.Data }))
      socket.on('end', () => send(null, peerId, { linkId, socketId, event: SocketEventType.End }))
      socket.on('close', () => send(null, peerId, { linkId, socketId, event: SocketEventType.Close }))
      socket.on('error', err => console.error('Tunnel server error:', err))
    }

    onScopeDispose(() => {
      for (const socket of sockets.values()) {
        socket.end()
        socket.destroy()
      }
      receivers.delete(linkId)
    })
  }

  const servers = shallowReactive(new Map<string, Map<string, EffectScope>>())
  onScopeDispose(() => {
    for (const links of servers.values()) {
      for (const scope of links.values()) {
        scope.stop()
      }
    }
  })

  return {
    sharedServers: readonly(servers),
    createTunnel(port: number, host: string) {
      for (const info of serversMap.values()) {
        if (info.peerId === connection.selfId && info.port === port && info.host === host) {
          window.showErrorMessage(`You are already sharing ${host}:${port}`)
          return
        }
      }
      const serverId = nanoid(9)
      const serverInfo: ServerInfo = {
        serverId,
        peerId: connection.selfId,
        name: `${host}:${port}`,
        host,
        port,
        createdAt: Date.now(),
      }
      serversMap.set(serverId, serverInfo)
      servers.set(serverId, shallowReactive(new Map()))
      return serverInfo
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
      for (const scope of servers.get(serverId)?.values() || []) {
        scope.stop()
      }
      servers.delete(serverId)
    },
    async linkTunnel(serverId: string, peerId: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        throw new Error(`Server not found: ${serverId}`)
      }
      if (info.peerId !== connection.selfId) {
        throw new Error(`Server ${serverId} is not owned by ${connection.selfId}`)
      }
      const scope = effectScope(true)
      const links = servers.get(serverId)
      if (!links) {
        throw new Error(`Server not found: ${serverId}`)
      }
      if (links.has(peerId)) {
        throw new Error(`Link already exists for peer ${peerId}`)
      }
      links.set(peerId, scope)
      const linkId = `${serverId}/${peerId}`
      scope.run(() => {
        useServer(peerId, linkId, info.port, info.host)
      })
      return linkId
    },
    unlinkTunnel(serverId: string, peerId: string) {
      const scope = servers.get(serverId)?.get(peerId)
      if (!scope) {
        throw new Error(`Link not found for peer ${peerId}`)
      }
      scope.stop()
      servers.get(serverId)?.delete(peerId)
    },
  }
}
