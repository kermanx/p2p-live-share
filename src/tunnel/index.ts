import type * as Y from 'yjs'
import type { Connection } from '../sync/connection'
import type { ServerInfo } from './types'
import { useShallowYMap } from '../sync/doc'
import { useTunnelClients } from './client'
import { useTunnelServers } from './server'

export function useTunnels(connection: Connection, doc: Y.Doc) {
  const serversMap = doc.getMap<ServerInfo>('tunnel')

  const { sharedServers, createTunnel, closeTunnel, linkTunnel, unlinkTunnel } = useTunnelServers(connection, serversMap)
  const { connectedServers, createClient, closeClient } = useTunnelClients(connection)

  const [sendLink, recvLink] = connection.makeAction<string>('tunnel-link')
  recvLink((serverId, peerId) => linkTunnel(serverId, peerId))
  const [sendUnlink, recvUnlink] = connection.makeAction<string>('tunnel-unlink')
  recvUnlink((serverId, peerId) => unlinkTunnel(serverId, peerId))

  return {
    serversMap: useShallowYMap(() => serversMap),
    sharedServers,
    connectedServers,
    createTunnel,
    closeTunnel,
    async linkTunnel(serverId: string, targetPort: number, targetHost: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        throw new Error(`Server not found: ${serverId}`)
      }
      await sendLink(serverId, info.peerId)
      await createClient(info, targetPort, targetHost)
    },
    async unlinkTunnel(serverId: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        throw new Error(`Server not found: ${serverId}`)
      }
      sendUnlink(serverId, info.peerId)
      closeClient(serverId)
    },
  }
}
