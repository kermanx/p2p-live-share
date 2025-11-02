import type { InternalConnection, InternalReceiver } from '../connection'
import type { ConnectionConfig } from '../share'
import { onScopeDispose, shallowRef, useEventEmitter } from 'reactive-vscode'
import { configs } from '../../configs'
import { useWebview } from '../../ui/webview/webview'
import { AckActionName, useSyncController } from './controller'

const TrysteroConfig = {
  appId: `p2p-live-share-${(114514).toString(36)}`,
}

export function useSteroConnection(config: ConnectionConfig): InternalConnection {
  const { domain: strategy, roomId } = config
  const { rpc, trysteroHandlers, trysteroSelfId } = useWebview()

  const onMessage = useEventEmitter<Parameters<InternalReceiver>>()
  const onError = useEventEmitter<string>()
  const onClose = useEventEmitter<void>()
  const peers = shallowRef<string[]>([])
  let closed = false

  const { send, recv } = useSyncController(
    peers,
    (...args) => rpc.trysteroSend(...args),
    (...args) => onMessage.fire(args),
  )

  trysteroHandlers.value = {
    onTrysteroError: onError.fire,
    onTrysteroUpdatePeers: (p) => { peers.value = p },
    onTrysteroMessage: recv,
  }

  const ready = rpc.trysteroJoinRoom(strategy, {
    ...TrysteroConfig,
    ...configs.trysteroConfig,
  }, roomId).then(() => {
    rpc.trysteroListenAction(AckActionName)
  })

  onScopeDispose(() => {
    closed = true
    rpc.trysteroLeaveRoom()
  })

  return {
    selfId: trysteroSelfId,
    peers,
    ready,
    listenMessage: rpc.trysteroListenAction,
    sendMessage: async (...args) => {
      if (closed) {
        throw new Error('Trystero connection is closed')
      }
      return await send(...args)
    },
    onMessage: onMessage.event,
    onError: onError.event,
    onClose: onClose.event,
  }
}
