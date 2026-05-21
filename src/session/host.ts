import type { ConnectionConfig } from '../sync/share'
import type { HostMeta } from './types'
import process from 'node:process'
import { effectScope, watch } from 'reactive-vscode'
import * as Y from 'yjs'
import { useHostDiagnostics } from '../diagnostics/host'
import { useHostFs } from '../fs/host'
import { useHostLs } from '../ls/host'
import { useHostRpc } from '../rpc/host'
import { useConnection } from '../sync/connection'
import { useDocSync } from '../sync/doc'
import { useHostTerminals } from '../terminal/host'
import { useUsers } from '../ui/users'
import { useWebview } from '../webview'
import { ProtocolVersion } from './index'

export async function createHostSession(config: ConnectionConfig) {
  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const doc = new Y.Doc()

  return scope.run(() => {
    useDocSync(connection, doc)

    const hostMeta: HostMeta = {
      version: ProtocolVersion,
      os: process.platform,
    }
    
    
    const [sendInit] = connection.makeAction<Uint8Array, HostMeta>('init')
    const [sendKick] = connection.makeAction<void>('kick-clone')
    const [_, recvIdentify] = connection.makeAction<string>('identify-guest')

    const activeGuests = new Map<string, string>()

    recvIdentify((guestName, peerId) => {
      const oldPeerId = activeGuests.get(guestName)
      if (oldPeerId && oldPeerId !== peerId) {
        sendKick(undefined, oldPeerId)
      }
      activeGuests.set(guestName, peerId)
    })

    watch(connection.peers, (newPeers, oldPeers) => {
      if (oldPeers) {
        for (const oldPeer of oldPeers) {
          if (!newPeers.includes(oldPeer)) {
            for (const [name, id] of activeGuests.entries()) {
              if (id === oldPeer) {
                activeGuests.delete(name)
              }
            }
          }
        }
      }

      for (const peerId of newPeers) {
        if (!oldPeers?.includes(peerId)) {
          sendInit(Y.encodeStateAsUpdateV2(doc), peerId, hostMeta)
        }
      }
    }, { immediate: true })

    const fs = useHostFs(connection)
    const terminals = useHostTerminals(connection, doc)
    useHostRpc(connection, {
      ...fs,
      ...terminals,
    })
    useHostLs(connection)
    useHostDiagnostics(connection, doc)
    useWebview().useChat(connection)
    useUsers().useCurrentUser(connection, doc)

    return {
      role: 'host' as const,
      hostId: connection.selfId,
      hostMeta,
      connection,
      doc,
      scope,
      shadowTerminals: terminals.shadowTerminals,
    }
  })!
}