import type { Connection } from '../sync/connection'
import type { ClientFunctions, HostFunctions } from './types'
import { createBirpc } from 'birpc'
import { deserialize, serialize } from './serialize'

export function useHostRpc(
  connection: Connection,
  functions: HostFunctions,
) {
  const [sendRpcData, recvRpcData] = connection.makeAction('rpc')

  const rpc = createBirpc<ClientFunctions, HostFunctions>(
    functions,
    {
      post: (data, peerId) => sendRpcData(data, peerId),
      on: fn => recvRpcData((data, peerId) => fn(data, peerId)),
      serialize,
      deserialize,
    },
  )

  return rpc
}
