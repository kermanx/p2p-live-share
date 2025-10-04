import type { ConnectionConfig } from '../sync/share'
import { effectScope, watchEffect } from 'reactive-vscode'
import { ProgressLocation, window } from 'vscode'
import * as Y from 'yjs'
import { useClientDiagnostics } from '../diagnostics/client'
import { useClientFs } from '../fs/client'
import { useClientLs } from '../ls/client'
import { useClientRpc } from '../rpc/client'
import { useConnection } from '../sync/connection'
import { useDocSync } from '../sync/doc'
import { useClientTerminals } from '../terminal/client'
import { useCurrentUser } from '../ui/users'
import { useWebview } from '../ui/webview/webview'
import { ClientCompatibleVersions, onSessionClosed } from './index'

export async function createClientSession(config: ConnectionConfig) {
  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const [_, recvInit] = connection.makeAction<Uint8Array>('init')
  const initResult = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'P2P Live Share: Joining session...',
      cancellable: true,
    },
    (_progress, token) => new Promise<null | [Uint8Array, string, string]>((resolve) => {
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
      recvInit((data, hostId, { version }) => {
        resolve([data, hostId, version])
        clearTimeout(timeoutId)
      })
    }),
  )
  if (!initResult) {
    return null
  }
  const [initUpdate, hostId, hostVersion] = initResult

  if (!ClientCompatibleVersions.includes(hostVersion)) {
    await window.showErrorMessage(
      'P2P Live Share: Incompatible host version.',
      {
        modal: true,
        detail: `Host version: ${hostVersion}.\nCompatible versions: ${ClientCompatibleVersions.join(', ')}.`,
      },
    )
    return null
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, initUpdate)

  return scope.run(() => {
    useDocSync(connection, doc)
    const rpc = useClientRpc(connection, hostId)
    useClientFs(doc, rpc)
    const { shadowTerminals } = useClientTerminals(doc, rpc)
    useClientLs(connection, hostId)
    useClientDiagnostics(doc)
    useWebview().useChat(connection)
    useCurrentUser()

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
      role: 'client' as const,
      hostId,
      connection,
      doc,
      scope,
      shadowTerminals,
    }
  })!
}
