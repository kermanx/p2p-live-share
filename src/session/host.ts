import type { ConnectionConfig } from '../sync/share'
import type { HostMeta } from './types'
import process from 'node:process'
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
import { useUsers } from '../ui/users'
import { useWebview } from '../ui/webview/webview'

export async function createHostSession(config: ConnectionConfig) {
  const scope = effectScope(true)
  const connection = scope.run(() => useConnection(config))!
  await connection.ready

  const doc = new Y.Doc()

  return scope.run(() => {
    useDocSync(connection, doc)

    const hostMeta: HostMeta = {
      version: HostVersion,
      os: process.platform,
    }
    const [sendInit] = connection.makeAction<Uint8Array, HostMeta>('init')
    watch(connection.peers, (newPeers, oldPeers) => {
      for (const peerId of newPeers) {
        if (!oldPeers?.includes(peerId)) {
          sendInit(Y.encodeStateAsUpdate(doc), peerId, hostMeta)
        }
      }
    }, { immediate: true })

    const fs = useHostFs(connection, doc)
    const terminals = useHostTerminals(doc)
    const scm = useHostScm(connection, doc)
    useHostRpc(connection, {
      ...fs,
      ...terminals,
      ...scm,
    })
    useHostLs(connection)
    useHostDiagnostics(connection, doc)
    const tunnels = useTunnels(connection, doc)
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
      tunnels,
    }
  })!
}
