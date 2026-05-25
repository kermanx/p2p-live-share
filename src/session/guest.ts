import type { ConnectionConfig } from '../sync/share'
import type { HostMeta } from './types'
import { effectScope, watchEffect } from 'reactive-vscode'
import { ProgressLocation, window, commands } from 'vscode'
import * as Y from 'yjs'
import { useGuestFs } from '../fs/guest'
import { useGuestLs } from '../ls/guest'
import { useGuestRpc } from '../rpc/guest'
import { useConnection } from '../sync/connection'
import { useDocSync } from '../sync/doc'
import { useGuestTerminals } from '../terminal/guest'
import { useUsers } from '../ui/users'
import { useWebview } from '../webview'
import { onSessionClosed, ProtocolVersion } from './index'
import { UpdatePermissionsAction, UpdateGlobalLockAction, ForceSyncAction } from '../sync/ws/protocol'

export async function createGuestSession(config: ConnectionConfig & { path: string }, guestName: string) {

  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const [_, recvInit] = connection.makeAction<Uint8Array, HostMeta>('init')

  const [sendIdentify] = connection.makeAction<string>('identify-guest')
  
  // Ignora o primeiro parametro e evita erro de redeclaracao de variavel
  const [, recvKick] = connection.makeAction<void>('kick-clone')


  const initResult = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'CRC Live Share (Puc Minas): Tentando entrar na sessão...',
      cancellable: true,
    },
    (_progress, token) => new Promise<null | [Uint8Array, string, HostMeta]>((resolve) => {
      token.onCancellationRequested(() => resolve(null))
      
      const timeoutId = setTimeout(() => {
        resolve(null)
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
      'CRC Live Share (Puc Minas): Incompatible host version.',
      {
        modal: true,
        detail: `Host version: ${hostMeta.version}.\nLocal version: ${ProtocolVersion}.`,
      },
    )
    return null
  }
  // Envia o nome de identificação para o host assim que conectar
  sendIdentify(guestName, hostId)
  // Ouve a ordem de aniquilação vinda do host
  recvKick(() => {
    // Mostra um aviso claro de que a aba virou um zumbi
    window.showWarningMessage("Sessão transferida: Você conectou em outra aba. Esta janela foi desconectada.")
    
    // Chama a Morte Silenciosa que acabamos de criar, preservando o Workspace para a Aba 2!
    commands.executeCommand('p2p-live-share.kickLeave')
  })
  return scope.run(() => {
    const doc = new Y.Doc()
    useDocSync(connection, doc)
    Y.applyUpdateV2(doc, initUpdate)

    const rpc = useGuestRpc(connection, hostId)
    useGuestFs(connection, rpc, hostId)
    const { shadowTerminals } = useGuestTerminals(connection, doc, rpc, hostId)
    useGuestLs(connection, hostId)
    useUsers().useCurrentUser(connection, doc)

    watchEffect(() => {
      if (!connection.peers.value.includes(hostId)) {
        setTimeout(() => {
          onSessionClosed({
            title: 'CRC Live Share (Puc Minas): Host has disconnected.',
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
    }
  })!
}
