import type { Connection } from '../sync/connection'
import type { ClientFunctions, HostFunctions } from './types'
import { createBirpc } from 'birpc'
import { deserialize, serialize } from './serialize'

export function useClientRpc(connection: Connection, hostId: string) {
  const [sendRpcData, recvRpcData] = connection.makeAction('rpc')

  const rpc = createBirpc<HostFunctions, ClientFunctions>(
    {
    },
    {
      post: data => sendRpcData(data, hostId),
      on: fn => recvRpcData(data => fn(data)),
      serialize,
      deserialize,
    },
  )

  return rpc
}
