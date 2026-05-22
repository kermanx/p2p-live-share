import type { QuickPickItem } from 'vscode'
import { customAlphabet } from 'nanoid'
import { ConfigurationTarget, env, ThemeIcon, Uri, window, workspace } from 'vscode'
import { configs } from '../configs'
import { CustomUriScheme } from '../fs/provider'
import { useUsers } from '../ui/users'

export interface ConnectionConfig {
  type: 'ws' | 'wss'
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
    scheme: CustomUriScheme,
    authority,
    path: path.startsWith('/') ? path : `/${path}`,
  })
}

export function parseTrackUri(uri: Uri): ConnectionConfig & { path: string } | null {
  if (uri.scheme !== CustomUriScheme) {
    return null
  }
  const [typeAndRoomId, folderIndex] = uri.authority.split('|', 2)
  const [type, roomId, ...domainParts] = typeAndRoomId.split('.')
  const domain = domainParts.join('.')
  if (!type || !roomId || !domain) {
    return null
  }
  if (type !== 'ws' && type !== 'wss') {
    return null
  }
  return {
    path: uri.path,
    type: type as 'ws' | 'wss',
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

async function inquireServer(): Promise<Partial<ConnectionConfig>>{
  const host = "devocto-collab-server"
  const protocol = 'ws'
  return {
    type: protocol as 'ws' | 'wss',
    domain: host // Mantenha apenas o host aqui
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

export async function copyShareLink(config: ConnectionConfig, isHosting = false) {
  const shareLink = makeTrackUri(config, workspace.workspaceFolders![config.workspace].uri)!.toString()
  while (true) {
    env.clipboard.writeText(decodeURIComponent(shareLink))
    const res = await window.showInformationMessage(`${isHosting ? 'Hosting session. ' : ''}The invitation link has been copied to clipboard.

Others may join this session by clicking on the "Join" button and pasting this link.`, 'Copy Again')
    isHosting = false
    if (res !== 'Copy Again') {
      break
    }
  }
}

export function validateShareLink(value: string) {
  if (!value.trim().startsWith(`${CustomUriScheme}://`)) {
    return `URI must start with ${CustomUriScheme}://`
  }
  try {
    const parsed = parseTrackUri(Uri.parse(value.trim()))
    if (parsed) {
      return null
    }
  }
  catch {}
  return `Invalid invitation link. A valid link looks like: p2p-live-share://ws.room.domain:port/`
}
