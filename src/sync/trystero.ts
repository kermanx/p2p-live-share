import type { InternalConnection, InternalReceiver } from './connection'
import type { ConnectionConfig } from './share'
import { onScopeDispose, shallowRef, useEventEmitter } from 'reactive-vscode'
import { configs } from '../configs'
import { useWebview } from '../ui/webview/webview'

const TrysteroConfig = {
  appId: `p2p-live-share-${(114514).toString(36)}`,
}

export function useSteroConnection(config: ConnectionConfig): InternalConnection {
  const { domain: strategy, roomId } = config
  const { rpc, trysteroHandlers, trysteroSelfId } = useWebview()

  const onError = useEventEmitter<string>()
  const onMessage = useEventEmitter<Parameters<InternalReceiver>>()
  const peers = shallowRef<string[]>([])
  let closed = false

  trysteroHandlers.value = {
    onTrysteroError: onError.fire,
    onTrysteroUpdatePeers: (p) => { peers.value = p },
    onTrysteroMessage: (...args) => onMessage.fire(args),
  }

  const ready = rpc.trysteroJoinRoom(strategy, {
    ...TrysteroConfig,
    ...configs.trysteroConfig,
  }, roomId)
  onScopeDispose(() => {
    closed = true
    rpc.trysteroLeaveRoom()
  })

  return {
    selfId: trysteroSelfId,
    peers,
    ready,
    listenMessage: rpc.trysteroListenAction,
    sendMessage: (...args) => {
      if (closed) {
        throw new Error('Trystero connection is closed')
      }
      return rpc.trysteroSend(...args)
    },
    onMessage: onMessage.event,
    onError: onError.event,
  }
}
