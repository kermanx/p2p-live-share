import { computed, createSingletonComposable, useCommands, useTreeView, useVscodeContext } from 'reactive-vscode'
import { ThemeIcon, window } from 'vscode'
import { useActiveSession } from '../session'

export const useTunnelsTree = createSingletonComposable(() => {
  useVscodeContext('p2p-live-share:supportsTunnels', true)

  const { tunnels, selfId } = useActiveSession()

  const connectedServers = computed(() => {
    if (!tunnels.value) {
      return new Set<string>()
    }
    const allClients = Array.from(tunnels.value.clientsMap.values())
    return new Set(allClients.map(c => c.serverId))
  })

  const sortedTunnels = computed(() => {
    if (!tunnels.value) {
      return []
    }
    const allTunnels = Array.from(tunnels.value.serversMap.values())

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
    computed(() => sortedTunnels.value.map((tunnel) => {
      const serving = tunnel.peerId === selfId.value
      const connected = connectedServers.value.has(tunnel.serverId)
      return {
        treeItem: {
          serverId: tunnel.serverId,
          label: tunnel.name || `${tunnel.host}:${tunnel.port}`,
          description: serving ? '(Serving)' : '',
          tooltip: `${tunnel.host}:${tunnel.port} (ID: ${tunnel.serverId})`,
          iconPath: new ThemeIcon(serving ? 'server' : connected ? 'link' : 'globe'),
          contextValue: serving ? 'serving' : connected ? 'connected' : 'available',
        },
      }
    })),
  )

  useCommands({
    'p2p-live-share.shareServer': async () => {
      if (!tunnels.value) {
        window.showWarningMessage('No active session or not supported.')
        return
      }
      const { createTunnel } = tunnels.value
      const urlOrPort = await window.showInputBox({
        title: 'Share Server',
        prompt: 'Enter the TCP port or server URL to share.',
        placeHolder: 'e.g. 5173, http://localhost:5173',
        validateInput(value) {
          if (!value.trim()) {
            return
          }
          const parsed = parsePortOrUrl(value)
          if (typeof parsed === 'string') {
            return parsed
          }
        },
      })
      if (!urlOrPort?.trim()) {
        return
      }
      const parsed = parsePortOrUrl(urlOrPort)
      if (typeof parsed === 'string') {
        window.showErrorMessage(`Failed to parse input: ${parsed}`)
        return
      }
      const { port, host } = parsed
      createTunnel(port, host)
    },
    'p2p-live-share.stopSharingServer': async (item?: any) => {
      if (!tunnels.value) {
        window.showWarningMessage('No active session or not supported.')
        return
      }
      const { serversMap, closeTunnel } = tunnels.value
      let serverId = item?.treeItem?.serverId
      if (!serverId) {
        serverId = await window.showQuickPick(
          Array.from(serversMap.values())
            .filter(info => info.peerId === selfId.value)
            .map(info => ({
              label: info.name,
              description: `${info.host}:${info.port}`,
              serverId: info.serverId,
            })),
          { placeHolder: 'Select a server to stop sharing' },
        ).then(item => item?.serverId)
      }
      if (!serverId) {
        return
      }
      closeTunnel(serverId)
    },
    'p2p-live-share.connectToSharedServer': () => {

    },
    'p2p-live-share.disconnectFromSharedServer': () => {

    },
  })
})

/**
 * Valid inputs:
 * - 8080
 * - localhost:8080
 * - example.com:8080
 * - http://localhost:8080
 * - https://example.com:8080
 * - http://example.com (default port 80)
 */
function parsePortOrUrl(input: string) {
  input = input.trim()
  const port = Number(input)
  if (Number.isFinite(port)) {
    if (port <= 0 || port >= 65536) {
      return 'Invalid port number.'
    }
    return { port, host: 'localhost' }
  }
  let defaultPort = null
  input = input.replace(/^(\w+):\/\//, (_, scheme) => {
    defaultPort = schemeToPort[scheme.toLowerCase()] || null
    return ''
  })
  const parts = input.split('/', 1)[0].split(':')
  if (parts.length === 1) {
    const host = parts[0]
    if (defaultPort === null) {
      return 'Port is required.'
    }
    return { port: defaultPort, host }
  }
  else if (parts.length === 2) {
    const host = parts[0]
    const port = Number(parts[1])
    if (Number.isNaN(port) || port <= 0 || port >= 65536) {
      return 'Invalid port number.'
    }
    return { port, host }
  }
  return 'Invalid input.'
}

const schemeToPort: Record<string, number> = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  ftp: 21,
  ftps: 990,
  ssh: 22,
  telnet: 23,
  smtp: 25,
  dns: 53,
  dhcp: 67,
  tftp: 69,
}
