import type { InternalConnection, InternalReceiver, TargetPeers } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { UpdatePeersAction } from './protocol'

export function useWebSocketHostConnection(config: ConnectionConfig): InternalConnection {
  const selfId = nanoid(10)

  let readyResolve: () => void
  let readyReject: (reason?: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const onMessage = useEventEmitter<Parameters<InternalReceiver>>()
  const onError = useEventEmitter<string>()
  const onClose = useEventEmitter<void>()
  let closed = false

  const server = (async () => {
    const { createServer } = await import('./server')
    const server = createServer({
      ...config.host!,
      hostMode: {
        roomId: config.roomId,
        hostId: selfId,
        onHostMessage: (message) => {
          const { action, data, metadata, peerId } = message
          if (action === UpdatePeersAction) {
            peers.value = (data as string[]).filter(id => id !== selfId)
            return
          }
          onMessage.fire([action, data, peerId, metadata])
        },
      },
      onServerStart: () => {
        readyResolve()
      },
      onError: (error: Error) => {
        console.error(error)
        onError.fire(`WebSocket server error: ${error.message || ''}`)
        readyReject(new Error(`WebSocket server error: ${error.message || ''}`))
      },
    })
    server.start()
    return server
  })()

  const peers = ref<string[]>([])

  async function sendMessage(action: string, data: any, targetPeers?: TargetPeers, metadata?: any) {
    if (closed) {
      throw new Error('WebSocket is closed')
    }

    (await server).handleMessage({
      action,
      data,
      targetPeers,
      metadata,
    }, config.roomId, selfId)
  }

  onScopeDispose(async () => {
    closed = true
    ;(await server).stop()
  })

  return {
    selfId,
    peers,
    ready,
    listenMessage: () => {},
    sendMessage,
    onMessage: onMessage.event,
    onError: onError.event,
    onClose: onClose.event,
  }
}
