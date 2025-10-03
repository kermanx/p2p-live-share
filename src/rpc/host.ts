import type { useHostFs } from '../fs/host'
import type { Connection } from '../sync/connection'
import type { useHostTerminals } from '../terminal/host'
import type { ClientFunctions, HostFunctions } from './types'
import { createBirpc } from 'birpc'
import { deserialize, serialize } from './serialize'

export function useHostRpc(
  connection: Connection,
  fs: ReturnType<typeof useHostFs>,
  terminals: ReturnType<typeof useHostTerminals>,
) {
  const [sendRpcData, recvRpcData] = connection.makeAction('rpc')

  const rpc = createBirpc<ClientFunctions, HostFunctions>(
    {
      ...fs,
      ...terminals,
    },
    {
      post: (data, peerId) => sendRpcData(data, peerId),
      on: fn => recvRpcData((data, peerId) => fn(data, peerId)),
      serialize,
      deserialize,
    },
  )

  return rpc
}
