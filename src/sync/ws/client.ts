import type { InternalConnection, InternalReceiver, TargetPeers } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { deserializeDownlink, serializeUplink, UpdatePeersAction } from './protocol'

export function useWebSocketConnection(config: ConnectionConfig): InternalConnection {
  const selfId = nanoid(10)
  const serverUrl = `${config.type}://${config.domain}/${config.roomId}/${selfId}`
  logger.info('Connecting to WebSocket server:', serverUrl)
  const socket = new WebSocket(serverUrl)
  socket.binaryType = 'arraybuffer'

  const peers = ref<string[]>([])

  let readyResolve: () => void
  const ready = new Promise<void>(resolve => readyResolve = resolve)
  socket.onopen = readyResolve!

  const onMessage = useEventEmitter<Parameters<InternalReceiver>>()
  const onError = useEventEmitter<string>()
  let closed = false

  async function sendMessage(action: string, data: any, targetPeers?: TargetPeers, metadata?: any) {
    if (closed) {
      throw new Error('WebSocket is closed')
    }

    socket.send(serializeUplink({
      action,
      data,
      targetPeers,
      metadata,
    }))
  }
  socket.onmessage = (event) => {
    const { action, data, metadata, peerId } = deserializeDownlink(event.data)
    if (action === UpdatePeersAction) {
      peers.value = (data as string[]).filter(id => id !== selfId)
      return
    }
    onMessage.fire([action, data, peerId, metadata])
  }

  onScopeDispose(() => {
    closed = true
    socket.close()
  })
  socket.onclose = () => {
    if (!closed) {
      onError.fire('WebSocket closed unexpectedly')
      closed = true
    }
  }

  socket.onerror = (event) => {
    onError.fire(`WebSocket error: ${event.type}`)
  }

  return {
    selfId,
    peers,
    ready,
    listenMessage: () => {},
    sendMessage,
    onMessage: onMessage.event,
    onError: onError.event,
  }
}
