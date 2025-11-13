import type { InternalConnection, InternalReceiver, TargetPeers } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { useWebSocketHostConnection } from './host'
import { deserializeDownlink, serializeUplink, UpdatePeersAction } from './protocol'

let WebSocket_ = globalThis.WebSocket
if (import.meta.env.TARGET === 'node' && !WebSocket_) {
  // eslint-disable-next-line ts/no-require-imports
  WebSocket_ = require('ws').WebSocket
}

export function useWebSocketConnection(config: ConnectionConfig): InternalConnection {
  if (config.host) {
    return useWebSocketHostConnection(config)
  }

  const selfId = nanoid(10)
  const serverUrl = `${config.type}://${config.domain}/${config.roomId}/${selfId}`
  logger.info('Connecting to WebSocket server:', serverUrl)
  const socket = new WebSocket_(serverUrl)
  socket.binaryType = 'arraybuffer'

  const peers = ref<string[]>([])

  let readyResolve: () => void
  let readyReject: (reason?: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  socket.onopen = readyResolve!

  const onMessage = useEventEmitter<Parameters<InternalReceiver>>()
  const onError = useEventEmitter<string>()
  const onClose = useEventEmitter<void>()
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
      onClose.fire()
      closed = true
    }
  }

  socket.onerror = (event: any) => {
    console.error(event)
    onError.fire(`WebSocket error: ${event.type} ${event.message || ''}`)
    readyReject(new Error(`WebSocket error: ${event.type} ${event.message || ''}`))
  }

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
