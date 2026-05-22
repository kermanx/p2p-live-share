import type { InternalConnection, InternalReceiver, TargetPeers } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { base64ToUint8Array, uint8ArrayToBase64, UpdatePeersAction } from './protocol'

// Garante compatibilidade do WebSocket dependendo do ambiente onde a extensão roda
let WebSocket_ = globalThis.WebSocket
if (import.meta.env.TARGET === 'node' && !WebSocket_) {
  // eslint-disable-next-line ts/no-require-imports
  WebSocket_ = require('ws').WebSocket
}

export function useWebSocketHostConnection(config: ConnectionConfig): InternalConnection {
  const selfId = nanoid(10)

  // O professor conecta diretamente no barramento interno do Docker, igual ao aluno
  const hostInterno = 'devocto-backend:8001'
  const serverUrl = `ws://${hostInterno}/ws/code/${config.roomId}/?peerId=${selfId}`
  
  logger.info('Professor conectando ao barramento central:', serverUrl)
  const socket = new WebSocket_(serverUrl)
  
  // Define trafego como string pois enviaremos JSON com Base64
  socket.binaryType = 'string'

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
      throw new Error('WebSocket fechado')
    }

    let payloadUpdate: string | undefined = undefined

    // Converte os pacotes binários do Y.js para Base64 antes de mandar para o Django
    if (data instanceof Uint8Array) {
      payloadUpdate = uint8ArrayToBase64(data)
    }

    const envelope = {
      acao: action === 'doc' ? 'sincronizar_arquivo' : action,
      peerId: selfId,
      uri: metadata?.uri || 'documento_principal',
      update: payloadUpdate,
      data: payloadUpdate ? undefined : data,
      targetPeers,
      metadata
    }

    socket.send(JSON.stringify(envelope))
  }

  socket.onmessage = (event) => {
    try {
      const conteudo = JSON.parse(event.data)
      
      // 1. Blindagem: Corrige o 'null' injetado pelo Python de volta para 'undefined' do JS
      const dataPura = conteudo.data === null ? undefined : conteudo.data;
      const metaPura = conteudo.metadata === null ? undefined : conteudo.metadata;
      
      // 2. Se for uma atualização de documento puro
      if (conteudo.acao === 'atualizar_arquivo' && conteudo.update) {
        const binarioYjs = base64ToUint8Array(conteudo.update)
        onMessage.fire(['doc', binarioYjs, conteudo.peerId || 'servidor', metaPura])
        return
      }

      // 3. Atualização de lista de alunos/peers na sala
      if (conteudo.acao === UpdatePeersAction) {
        peers.value = (conteudo.data as string[]).filter(id => id !== selfId)
        return
      }

      // 4. Se for outra ação (como cursor/awareness) MAS tiver pacote binário (update)
      if (conteudo.update) {
        const binario = base64ToUint8Array(conteudo.update)
        onMessage.fire([conteudo.acao, binario, conteudo.peerId, metaPura])
        return
      }

      // 5. Se for mensagem comum de texto/json
      onMessage.fire([conteudo.acao, dataPura, conteudo.peerId, metaPura])
    } catch (err) {
      logger.error('Erro ao processar mensagem do Django:', err)
    }
  }

  onScopeDispose(() => {
    closed = true
    socket.close()
  })

  socket.onclose = () => {
    if (!closed) {
      onError.fire('Sessão com o servidor finalizada.')
      onClose.fire()
      closed = true
    }
  }

  socket.onerror = (event: any) => {
    console.error(event)
    onError.fire(`Erro de comunicação WebSocket: ${event.message || ''}`)
    readyReject(new Error(`Erro de comunicação WebSocket: ${event.message || ''}`))
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