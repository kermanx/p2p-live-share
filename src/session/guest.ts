import type { ConnectionConfig } from '../sync/share'
import type { HostMeta } from './types'
import { effectScope, watchEffect } from 'reactive-vscode'
import { ProgressLocation, window } from 'vscode'
import * as Y from 'yjs'
import { useGuestDiagnostics } from '../diagnostics/guest'
import { useGuestFs } from '../fs/guest'
import { useGuestLs } from '../ls/guest'
import { useGuestRpc } from '../rpc/guest'
import { useGuestScm } from '../scm/guest'
import { useConnection } from '../sync/connection'
import { useDocSync } from '../sync/doc'
import { useGuestTerminals } from '../terminal/guest'
import { useTunnels } from '../tunnel'
import { useUsers } from '../ui/users'
import { useWebview } from '../webview'
import { onSessionClosed, ProtocolVersion } from './index'

export async function createGuestSession(config: ConnectionConfig) {
  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const [_, recvInit] = connection.makeAction<Uint8Array, HostMeta>('init')
  const initResult = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'P2P Live Share: Joining session...',
      cancellable: true,
    },
    (_progress, token) => new Promise<null | [Uint8Array, string, HostMeta]>((resolve) => {
      token.onCancellationRequested(() => resolve(null))
      const timeoutId = setTimeout(async () => {
        const res = await window.showErrorMessage(
          'P2P Live Share: No host found at 15 seconds.',
          {
            modal: true,
            detail: 'Please make sure the host is online and you have the correct connection link.',
          },
          'Continue Waiting',
        )
        if (!res) {
          resolve(null)
        }
      }, 15000)
      recvInit((data, hostId, hostMeta) => {
        resolve([data, hostId, hostMeta!])
        clearTimeout(timeoutId)
      })
    }),
  )
  if (!initResult) {
    return null
  }
  const [initUpdate, hostId, hostMeta] = initResult

  if (!ProtocolVersion.includes(hostMeta.version)) {
    await window.showErrorMessage(
      'P2P Live Share: Incompatible host version.',
      {
        modal: true,
        detail: `Host version: ${hostMeta.version}.\nLocal version: ${ProtocolVersion}.`,
      },
    )
    return null
  }

  return scope.run(() => {
    const doc = new Y.Doc()
    useDocSync(connection, doc)
    Y.applyUpdateV2(doc, initUpdate)

    const rpc = useGuestRpc(connection, hostId)
    useGuestFs(connection, rpc, hostId)
    const { shadowTerminals } = useGuestTerminals(connection, doc, rpc, hostId)
    useGuestLs(connection, hostId)
    useGuestDiagnostics(doc)
    useGuestScm(doc, rpc)
    const tunnels = useTunnels(connection, doc)
    useWebview().useChat(connection)
    useUsers().useCurrentUser(connection, doc)

    watchEffect(() => {
      if (!connection.peers.value.includes(hostId)) {
        setTimeout(() => {
          onSessionClosed({
            title: 'P2P Live Share: Host has disconnected.',
            detail: 'This may be due to network issues, or the host may have closed the session.',
          })
        })
      }
    })

    return {
      role: 'guest' as const,
      hostId,
      hostMeta,
      connection,
      doc,
      scope,
      shadowTerminals,
      tunnels,
    }
  })!
}
