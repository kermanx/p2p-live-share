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
}

export function makeTrackUri(config: ConnectionConfig, uri_: Uri) {
  const folder = workspace.getWorkspaceFolder(uri_)
  if (!folder) {
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

export async function copyShareUri(config: ConnectionConfig, isHosting = false) {
  const shareUri = makeTrackUri(config, workspace.workspaceFolders![config.workspace].uri)!.toString()
  while (true) {
    env.clipboard.writeText(shareUri)
    const res = await window.showInformationMessage(`${isHosting ? 'Hosting session. ' : ''}The share link has been copied to clipboard.`, 'Copy Again')
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
  return `Invalid share link. A valid link looks like: p2p-live-share://ws.room.domain:port/ or p2p-live-share://trystero.room.mqtt/`
}
