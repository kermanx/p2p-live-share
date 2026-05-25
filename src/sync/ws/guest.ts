import type { InternalConnection, InternalReceiver } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { createWsSender, handleWsMessage } from './protocol'

let WebSocket_ = globalThis.WebSocket
if (import.meta.env.TARGET === 'node' && !WebSocket_) {
  // eslint-disable-next-line ts/no-require-imports
  WebSocket_ = require('ws').WebSocket
}

export function useWebSocketGuestConnection(config: ConnectionConfig): InternalConnection {
  const selfId = nanoid(10)
  
  const protocoloWs = config.type === 'wss' ? 'wss' : 'ws'
  const hostInterno = 'devocto-backend'
  const portHost = 8001
  
  logger?.info(`Protocolo WS: ${protocoloWs}, Host Interno: ${hostInterno}`)
  const serverUrl = `ws://${hostInterno}:${portHost}/ws/code/${config.roomId}/?peerId=${selfId}`
  
  logger.info('Conectando ao barramento central do DevOcto:', serverUrl)
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

  const sendMessage = createWsSender(socket, selfId, () => closed)

  socket.onmessage = (event) => {
    handleWsMessage(event, selfId, peers, (args) => onMessage.fire(args))
  }

  onScopeDispose(() => {
    closed = true
    socket.close()
  })

  socket.onclose = () => {
    if (!closed) {
      onError.fire('Sessao com o servidor DevOcto finalizada.')
      onClose.fire()
      closed = true
    }
  }

  socket.onerror = (event: any) => {
    console.error(event)
    onError.fire(`Erro de comunicacao WebSocket: ${event.message || ''}`)
    readyReject(new Error(`Erro de comunicacao WebSocket: ${event.message || ''}`))
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