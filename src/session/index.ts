import { computed, createSingletonComposable, onScopeDispose, shallowRef, useCommand, useVscodeContext, watch } from 'reactive-vscode'
import { commands, env, Uri, window, workspace } from 'vscode'
import { ClientUriScheme } from '../fs/provider'
import { copyShareUri, inquireHostConfig, makeTrackUri, parseTrackUri, validateShareLink } from '../sync/share'
import { useUsers } from '../ui/users'
import { useWebview } from '../ui/webview/webview'
import { createClientSession } from './client'
import { createHostSession } from './host'

export const useActiveSession = createSingletonComposable(() => {
  const session = shallowRef<null
    | Awaited<ReturnType<typeof createHostSession>>
    | Awaited<ReturnType<typeof createClientSession>>
  >(null)
  const isJoining = shallowRef(true)

  setTimeout(async () => {
    const folder = workspace.workspaceFolders?.find(folder => folder.uri.scheme === ClientUriScheme)
    try {
      if (folder) {
        await joinImpl(folder.uri)
      }
    }
    finally {
      isJoining.value = false
    }
  })

  function toTrackUri(uri: Uri) {
    if (!session.value) {
      throw new Error('Not in a session')
    }
    if (session.value.role === 'client') {
      return uri
    }
    return session.value.connection.toTrackUri(uri)
  }

  function toLocalUri(uri: Uri) {
    if (!session.value) {
      throw new Error('Not in a session')
    }
    if (session.value.role === 'client') {
      return uri
    }
    return session.value.connection.toHostUri(uri)
  }

  async function host() {
    if (session.value) {
      window.showErrorMessage('You are already in a session.')
      return
    }
    if (isJoining.value) {
      return
    }
    isJoining.value = true
    try {
      const [config, _] = await Promise.all([
        inquireHostConfig(),
        useWebview().ensureReady(),
      ])
      if (!config) {
        return
      }

      try {
        session.value = await createHostSession(config)
      }
      catch (error: any) {
        window.showErrorMessage(
          'P2P Live Share: Failed to start hosting.',
          {
            modal: true,
            detail: error?.message || String(error),
          },
        )
        return
      }

      copyShareUri(config, true)
    }
    finally {
      isJoining.value = false
    }
  }

  async function join(newWindow: boolean | 'auto') {
    if (session.value) {
      window.showErrorMessage('You are already in a session.')
      return
    }
    if (isJoining.value) {
      return
    }
    isJoining.value = true
    try {
      const clipboard = await env.clipboard.readText()
      const uriStr = await window.showInputBox({
        prompt: 'Enter URI',
        // placeHolder: 'room-id',
        value: validateShareLink(clipboard) === null ? clipboard : undefined,
        validateInput: validateShareLink,
      })
      if (!uriStr) {
        return
      }
      const uri = Uri.parse(uriStr.trim())

      if (newWindow) {
        commands.executeCommand('vscode.openFolder', uri, newWindow === 'auto'
          ? undefined
          : {
              forceNewWindow: newWindow,
              forceReuseWindow: !newWindow,
            })
      }
      else {
        const parsed = parseTrackUri(uri)
        workspace.updateWorkspaceFolders(0, workspace.workspaceFolders?.length ?? 0, {
          uri,
          name: `P2P Live Share (${parsed?.roomId})`,
        })
        await joinImpl(uri)
      }
    }
    finally {
      isJoining.value = false
    }
  }

  async function joinImpl(uri: Uri) {
    const parsed = parseTrackUri(uri)
    if (!parsed) {
      window.showErrorMessage(
        'P2P Live Share: Invalid Invite Link.',
        {
          modal: true,
          detail: 'The link you provided is not valid. Please check and try again. A valid link looks like: p2p-live-share://ws.room.domain:port/ or p2p-live-share://trystero.room.mqtt/',
        },
      )
      return
    }

    const { inquireUserName } = useUsers()

    const [name, _] = await Promise.all([
      inquireUserName(false),
      useWebview().ensureReady(),
    ])
    if (!name) {
      return
    }

    try {
      session.value = await createClientSession(parsed)
    }
    catch (error: any) {
      console.error(error)
      window.showErrorMessage(
        'P2P Live Share: Failed to join the session.',
        {
          modal: true,
          detail: error?.message || String(error),
        },
      )
    }
  }

  async function leave() {
    if (!session.value) {
      window.showErrorMessage('You are not in a session.')
      return
    }

    const wasClient = session.value.role === 'client'

    const res = await window.showInformationMessage(
      wasClient ? 'Confirm to leave the session?' : 'Confirm to stop sharing the session?',
      {
        modal: true,
        detail: wasClient ? 'Unsaved changes may be lost.' : 'You will stop sharing the workspace and all clients will be disconnected.',
      },
      'Leave',
    )

    if (res === 'Leave') {
      session.value = null
      if (wasClient) {
        workspace.updateWorkspaceFolders(0, workspace.workspaceFolders?.length)
      }
      window.showInformationMessage('You have left the session.')
    }
  }

  watch(session, (_, oldState) => oldState?.scope.stop())
  onScopeDispose(() => session.value?.scope.stop())

  useVscodeContext('p2p-live-share:inSession', computed(() => !!session.value))
  useVscodeContext('p2p-live-share:isHost', computed(() => session.value?.role === 'host'))
  useVscodeContext('p2p-live-share:isClient', computed(() => session.value?.role === 'client'))

  useCommand('p2p-live-share.host', host)
  useCommand('p2p-live-share.join', () => join(false))
  useCommand('p2p-live-share.joinNewWindow', () => join(true))
  useCommand('p2p-live-share.leave', leave)
  useCommand('p2p-live-share.stop', leave)
  useCommand('p2p-live-share.copyInviteLink', () => {
    if (session.value?.connection) {
      copyShareUri(session.value?.connection.config)
    }
    else {
      window.showErrorMessage('Not in a session.')
    }
  })

  return {
    state: session,
    role: computed(() => session.value?.role),
    doc: computed(() => session.value?.doc),
    selfId: computed(() => session.value?.connection.selfId),
    hostId: computed(() => session.value?.hostId),
    peers: computed(() => session.value?.connection.peers.value),
    connection: computed(() => session.value?.connection),
    shadowTerminals: computed(() => session.value?.shadowTerminals),
    tunnels: computed(() => session.value?.tunnels),
    isJoining,
    makeTrackUri,
    toTrackUri,
    toLocalUri,
    host,
    join,
    leave,
  }
})

export function onSessionClosed(options: {
  title: string
  detail: string
}) {
  const { state } = useActiveSession()
  if (!state.value) {
    return
  }
  const config = state.value.connection.config
  const creator = state.value.role === 'host' ? createHostSession : createClientSession

  state.value = null
  const delay = new Promise(resolve => setTimeout(resolve, 500))
  window.showErrorMessage(
    options.title,
    {
      modal: true,
      detail: options.detail,
    },
    'Reconnect',
  ).then(async (choice) => {
    if (choice === 'Reconnect') {
      await delay
      state.value = await creator(config)
    }
  })
}

export const HostVersion = '20251003'
export const ClientCompatibleVersions = [
  HostVersion,
]
