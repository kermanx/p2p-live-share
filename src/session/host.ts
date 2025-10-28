import type { ConnectionConfig } from '../sync/share'
import { effectScope, watch } from 'reactive-vscode'
import * as Y from 'yjs'
import { HostVersion } from '.'
import { useHostDiagnostics } from '../diagnostics/host'
import { useHostFs } from '../fs/host'
import { useHostLs } from '../ls/host'
import { useHostRpc } from '../rpc/host'
import { useHostScm } from '../scm/host'
import { useConnection } from '../sync/connection'
import { useDocSync } from '../sync/doc'
import { useHostTerminals } from '../terminal/host'
import { useTunnels } from '../tunnel'
import { useCurrentUser } from '../ui/users'
import { useWebview } from '../ui/webview/webview'

export async function createHostSession(config: ConnectionConfig) {
  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const doc = new Y.Doc()

  return scope.run(() => {
    useDocSync(connection, doc)
    const [sendInit] = connection.makeAction<Uint8Array>('init')
    watch(connection.peers, (newPeers, oldPeers) => {
      for (const peerId of newPeers) {
        if (!oldPeers?.includes(peerId)) {
          sendInit(Y.encodeStateAsUpdate(doc), peerId, { version: HostVersion })
        }
      }
    }, { immediate: true })

    const fs = useHostFs(connection, doc)
    const terminals = useHostTerminals(doc)
    useHostRpc(connection, fs, terminals)
    useHostLs(connection)
    useHostDiagnostics(connection, doc)
    useHostScm(connection, doc)
    const tunnels = useTunnels(connection, doc)
    useWebview().useChat(connection)
    useCurrentUser()

    return {
      role: 'host' as const,
      hostId: connection.selfId,
      connection,
      doc,
      scope,
      shadowTerminals: terminals.shadowTerminals,
      tunnels,
    }
  })!
}
