import { computed, createSingletonComposable, useTreeView, useVscodeContext } from 'reactive-vscode'
import { ThemeIcon } from 'vscode'
import { useActiveSession } from '../session'

export const useTunnelsTree = createSingletonComposable(() => {
  useVscodeContext('p2p-live-share:supportsTunnels', true)

  const { tunnels, selfId } = useActiveSession()

  const connectedServers = computed(() => {
    if (!tunnels.value) {
      return new Set<string>()
    }
    const allClients = Array.from(tunnels.value.tunnelClients.values())
    return new Set(allClients.map(c => c.serverId))
  })

  const sortedTunnels = computed(() => {
    if (!tunnels.value) {
      return []
    }
    const allTunnels = Object.values(tunnels.value.tunnelsMap)

    const hostByMe = allTunnels
      .filter(t => t.peerId === selfId.value)
      .sort((a, b) => b.createdAt - a.createdAt)
    const connected = allTunnels
      .filter(t => connectedServers.value.has(t.serverId))
      .sort((a, b) => b.createdAt - a.createdAt)
    const others = allTunnels
      .filter(t => t.peerId !== selfId.value && !connectedServers.value.has(t.serverId))
      .sort((a, b) => b.createdAt - a.createdAt)

    return [...hostByMe, ...connected, ...others]
  })

  useTreeView(
    'p2p-live-share.tunnels',
    () => sortedTunnels.value.map((tunnel) => {
      const serving = tunnel.peerId === selfId.value
      const connected = connectedServers.value.has(tunnel.serverId)
      return {
        treeItem: {
          label: tunnel.name || `${tunnel.host}:${tunnel.port}`,
          description: serving ? '(Serving)' : '',
          tooltip: `${tunnel.host}:${tunnel.port} (ID: ${tunnel.serverId})`,
          iconPath: new ThemeIcon(serving ? 'server' : connected ? 'link' : 'globe'),
          contextValue: serving ? 'serving' : connected ? 'connected' : 'available',
        },
      }
    }),
  )
})
