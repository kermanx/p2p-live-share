import type { InternalConnection, InternalReceiver } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { createWsSender, handleWsMessage } from './protocol'

let InstanciaWebSocket = globalThis.WebSocket
if (import.meta.env.TARGET === 'node' && !InstanciaWebSocket) {
  InstanciaWebSocket = require('ws').WebSocket
}

export function usarConexaoWebSocket(configuracao: ConnectionConfig): InternalConnection {
  const idProprio = nanoid(10)
  const hostBackend = 'devocto-backend:8001'
  const urlServidor = `ws://${hostBackend}/ws/code/${configuracao.roomId}/?peerId=${idProprio}`
  
  logger.info('Conectando ao barramento central do DevOcto:', urlServidor)
  const soquete = new InstanciaWebSocket(urlServidor)
  soquete.binaryType = 'arraybuffer'

  const parceiros = ref<string[]>([])

  let resolverPronto: () => void
  let rejeitarPronto: (reason?: Error) => void
  const pronto = new Promise<void>((resolve, reject) => {
    resolverPronto = resolve
    rejeitarPronto = reject
  })
  
  soquete.onopen = resolverPronto!

  const aoReceberMensagem = useEventEmitter<Parameters<InternalReceiver>>()
  const aoDarErro = useEventEmitter<string>()
  const aoFechar = useEventEmitter<void>()
  let foiEncerrado = false

  const enviarMensagem = createWsSender(soquete, idProprio, () => foiEncerrado)

  soquete.onmessage = (evento) => {
    handleWsMessage(evento, idProprio, parceiros, (argumentos) => aoReceberMensagem.fire(argumentos))
  }

  onScopeDispose(() => {
    foiEncerrado = true
    soquete.close()
  })

  soquete.onclose = () => {
    if (!foiEncerrado) {
      aoDarErro.fire('Sessão com o servidor DevOcto finalizada.')
      aoFechar.fire()
      foiEncerrado = true
    }
  }

  soquete.onerror = (evento: any) => {
    console.error(evento)
    aoDarErro.fire(`Erro de comunicação WebSocket: ${evento.message || ''}`)
    rejeitarPronto(new Error(`Erro de comunicação WebSocket: ${evento.message || ''}`))
  }

  return {
    selfId: idProprio,
    peers: parceiros,
    ready: pronto,
    listenMessage: () => {},
    sendMessage: enviarMensagem,
    onMessage: aoReceberMensagem.event,
    onError: aoDarErro.event,
    onClose: aoFechar.event,
  }
}