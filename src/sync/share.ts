import type { QuickPickItem } from 'vscode'
import { customAlphabet } from 'nanoid'
import { ConfigurationTarget, env, ThemeIcon, Uri, window, workspace } from 'vscode'
import { configs } from '../configs'
import { ClientUriScheme } from '../fs/provider'
import { useUsers } from '../ui/users'

export interface ConnectionConfig {
  type: 'ws' | 'wss' | 'trystero'
  domain: string
  roomId: string
  workspace: number
  host?: {
    hostname: string
    port: number
  } | undefined
}

export function makeTrackUri(config: ConnectionConfig, uri_: Uri) {
  const folder = workspace.getWorkspaceFolder(uri_)
  if (!folder || folder.uri.scheme !== uri_.scheme) {
    return null
  }
  const path = uri_.toString().slice(folder.uri.toString().length)

  let authority = `${config.type}.${config.roomId}.${config.domain}`
  if (folder.index !== 0)
    authority += `|${folder.index}`
  return Uri.from({
    scheme: ClientUriScheme,
    authority,
    path: path.startsWith('/') ? path : `/${path}`,
  })
}

export function parseTrackUri(uri: Uri): ConnectionConfig & { path: string } | null {
  if (uri.scheme !== ClientUriScheme) {
    return null
  }
  const [typeAndRoomId, folderIndex] = uri.authority.split('|', 2)
  const [type, roomId, ...domainParts] = typeAndRoomId.split('.')
  const domain = domainParts.join('.')
  if (!type || !roomId || !domain) {
    return null
  }
  if (type !== 'ws' && type !== 'wss' && type !== 'trystero') {
    return null
  }
  return {
    path: uri.path,
    type,
    roomId,
    domain,
    workspace: +folderIndex || 0,
  }
}

export async function inquireHostConfig(): Promise<ConnectionConfig | null> {
  const { inquireUserName } = useUsers()
  const [server, _] = await Promise.all([
    inquireServer(),
    inquireUserName(true),
  ])
  if (!server) {
    return null
  }

  if (!workspace.workspaceFolders?.length) {
    window.showErrorMessage('No workspace folder is open.')
    return null
  }
  let folderIndex = 0
  if (workspace.workspaceFolders.length > 1) {
    const pick = await window.showQuickPick(
      workspace.workspaceFolders.map(f => ({
        label: f.name,
        description: f.uri.toString(),
        folderIndex: f.index,
      })),
      {
        placeHolder: 'Select a workspace folder to share',
      },
    )
    if (!pick) {
      return null
    }
    folderIndex = pick.folderIndex
  }

  return {
    ...server,
    roomId: generateRoomId(folderIndex),
    workspace: folderIndex,
  }
}

async function inquireServer() {
  let servers = [...configs.servers]
  const updateServers = (newServers: string[]) => {
    servers = newServers
    configs.$update('servers', newServers, ConfigurationTarget.Global)
  }

  const quickPick = window.createQuickPick()
  quickPick.title = 'Choose server'
  quickPick.placeholder = 'Enter websocket server URL (wss://) or choose a Trystero strategy'
  quickPick.value = ''
  let allItems = quickPick.items = [
    ...servers.map(s => ({
      label: s,
      description: 'Saved server',
      buttons: [{
        iconPath: new ThemeIcon('trash'),
        tooltip: 'Remove server',
      }],
    })),
    { label: 'trystero:mqtt', description: 'Trystero with MQTT strategy' },
    { label: 'trystero:nostr', description: 'Trystero with Nostr strategy' },
    { label: 'Host Locally', description: 'Share over local network' },
  ]
  quickPick.onDidChangeValue((value) => {
    if (value.startsWith('ws://') || value.startsWith('wss://') || 'ws://'.startsWith(value) || 'wss://'.startsWith(value)) {
      if (!allItems.find(i => i.label === value)) {
        quickPick.items = [{ label: value, description: 'Custom server' }, ...allItems]
        return
      }
    }
    quickPick.items = allItems
  })
  quickPick.onDidTriggerItemButton((e) => {
    const { label } = e.item
    if (e.button.tooltip === 'Remove server') {
      updateServers(servers.filter(s => s !== label))
      allItems = allItems.filter(i => i.label !== label)
      quickPick.items = quickPick.items.filter(i => i.label !== label)
    }
  })
  const result = await new Promise<string | undefined>((resolve) => {
    quickPick.onDidAccept(() => resolve(quickPick.selectedItems[0]?.label || quickPick.value || undefined))
    quickPick.onDidHide(() => resolve(undefined))
    quickPick.show()
  })
  quickPick.dispose()

  if (!result) {
    return null
  }
  if (result.startsWith('trystero:')) {
    const strategy = result.slice('trystero:'.length)
    if (strategy !== 'nostr' && strategy !== 'mqtt') {
      window.showErrorMessage('Invalid Trystero strategy')
      return null
    }
    return {
      type: 'trystero' as const,
      domain: strategy,
    }
  }
  if (import.meta.env.TARGET === 'node' && result === 'Host Locally') {
    const host = await inquireHostname()
    if (!host) {
      return null
    }
    const port = await (await import('get-port')).default({ host })
    return {
      type: 'ws' as const,
      domain: `${host.includes(':') ? `[${host}]` : host}:${port}`,
      host: {
        hostname: host,
        port,
      },
    }
  }
  if (!result.startsWith('ws://') && !result.startsWith('wss://')) {
    window.showErrorMessage('Invalid websocket server URL')
    return null
  }
  const url = new URL(result)
  if (url.pathname !== '/' || url.search || url.hash) {
    window.showErrorMessage('Websocket server URL should not contain path, query or hash')
    return null
  }
  updateServers([
    result,
    ...servers.filter(s => s !== result),
  ])
  return {
    type: url.protocol === 'wss:' ? 'wss' as const : 'ws' as const,
    domain: url.host,
  }
}

async function inquireHostname() {
  const os = await import('node:os')
  const interfaces = os.networkInterfaces()

  const items: QuickPickItem[] = []
  for (const ifaceName in interfaces) {
    const ifaceAddresses = interfaces[ifaceName]
    if (!ifaceAddresses)
      continue
    for (const addrInfo of ifaceAddresses) {
      if (addrInfo.address.startsWith('fe80::')) {
        continue
      }
      items.push({
        label: addrInfo.address,
        description: `Interface: ${ifaceName} (${addrInfo.family}${addrInfo.internal ? ', internal' : ''})`,
      })
    }
  }

  const countColons = (addr: string) => (addr.match(/:/g) || []).length
  items.sort((a, b) => countColons(a.label) - countColons(b.label))

  const result = await window.showQuickPick(items, {
    placeHolder: 'Select hostname for hosting',
  })

  return result?.label || null
}

const roomIdNanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6)
const folderToRoomId = new Map<string, string>()

function generateRoomId(folderIndex: number) {
  if (import.meta.env.NODE_ENV === 'development') {
    return 'testtest'
  }
  const folderUri = workspace.workspaceFolders![folderIndex].uri.toString()
  const existing = folderToRoomId.get(folderUri)
  if (existing) {
    return existing
  }
  const originalName = workspace.workspaceFolders![folderIndex].name || workspace.name || 'unknown'
  const normalizedName = originalName.split(/[^a-z0-9]+/i).filter(Boolean).join('-').toLowerCase()
  const roomId = `${normalizedName}-${roomIdNanoid()}`
  folderToRoomId.set(folderUri, roomId)
  return roomId
}

export async function copyShareLink(config: ConnectionConfig, isHosting = false) {
  const shareLink = makeTrackUri(config, workspace.workspaceFolders![config.workspace].uri)!.toString()
  while (true) {
    env.clipboard.writeText(decodeURIComponent(shareLink))
    const res = await window.showInformationMessage(`${isHosting ? 'Hosting session. ' : ''}The invite link has been copied to clipboard.

Others may join this session by clicking on the "Join" button and pasting this link.`, 'Copy Again')
    isHosting = false
    if (res !== 'Copy Again') {
      break
    }
  }
}

export function validateShareLink(value: string) {
  if (!value.trim().startsWith(`${ClientUriScheme}://`)) {
    return `URI must start with ${ClientUriScheme}://`
  }
  try {
    const parsed = parseTrackUri(Uri.parse(value.trim()))
    if (parsed) {
      return null
    }
  }
  catch {}
  return `Invalid invite link. A valid link looks like: p2p-live-share://ws.room.domain:port/ or p2p-live-share://trystero.room.mqtt/`
}
