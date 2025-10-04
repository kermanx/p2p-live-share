import type * as Y from 'yjs'
import type { Connection } from '../sync/connection'
import type { ServerInfo } from './types'
import { useCommands } from 'reactive-vscode'
import { useShallowYMap } from '../sync/doc'
import { useTunnelClients } from './client'
import { useTunnelServers } from './server'

export function useTunnels(connection: Connection, doc: Y.Doc) {
  const serversMap = doc.getMap<ServerInfo>('tunnel')

  const { createTunnel, linkTunnel } = useTunnelServers(connection, serversMap)
  const { tunnelClients, createClient } = useTunnelClients(connection)

  const [sendLink, recvLink] = connection.makeAction<string>('tunnel-link')
  recvLink((serverId, peerId) => linkTunnel(serverId, peerId))

  useCommands({
    'p2p-live-share.shareServer': () => {

    },
    'p2p-live-share.stopSharingServer': () => {

    },
    'p2p-live-share.connectToSharedServer': () => {

    },
    'p2p-live-share.disconnectFromSharedServer': () => {

    },
  })

  return {
    tunnelsMap: useShallowYMap(() => serversMap),
    tunnelClients,
    createTunnel,
    async linkTunnel(serverId: string, targetPort: number, targetHost: string) {
      const info = serversMap.get(serverId)
      if (!info) {
        throw new Error(`Server not found: ${serverId}`)
      }
      await sendLink(serverId, info.peerId)
      await createClient(info, targetPort, targetHost)
    },
  }
}
