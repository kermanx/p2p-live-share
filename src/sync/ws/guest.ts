import type { InternalConnection, InternalReceiver, TargetPeers } from '../connection'
import type { ConnectionConfig } from '../share'
import { nanoid } from 'nanoid'
import { onScopeDispose, ref, useEventEmitter } from 'reactive-vscode'
import { logger } from '../../utils'
import { base64ToUint8Array, uint8ArrayToBase64, UpdatePeersAction } from './protocol'

let WebSocket_ = globalThis.WebSocket
if (import.meta.env.TARGET === 'node' && !WebSocket_) {
  // eslint-disable-next-line ts/no-require-imports
  WebSocket_ = require('ws').WebSocket
}

export function useWebSocketGuestConnection(config: ConnectionConfig): InternalConnection {
  const selfId = nanoid(10)
  
  // Rota unificada baseada na estrutura do seu asgi.py do Django
  // O Traefik / Django cuidará do roteamento na porta padrão do backend
  const protocoloWs = config.type === 'wss' ? 'wss' : 'ws'
  const hostInterno = 'devocto-backend'
  const portHost = 8001
  // printa usando o codeserver aviso para mostrar o protocol e host interno
  logger?.info(`Protocolo WS: ${protocoloWs}, Host Interno: ${hostInterno}`)
  
  const serverUrl = `ws://${hostInterno}:${portHost}/ws/code/${config.roomId}/?peerId=${selfId}`
  
  logger.info('Conectando ao barramento central do DevOcto:', serverUrl)
  const socket = new WebSocket_(serverUrl)
  
  // Mudamos para 'string' porque agora trafegamos JSON puro encapsulado
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

  /**
   * Envia as alterações locais do VS Code para o Django centralizado
   */
  async function sendMessage(action: string, data: any, targetPeers?: TargetPeers, metadata?: any) {
    if (closed) {
      throw new Error('WebSocket is closed')
    }

    let payloadUpdate: string | undefined = undefined

    // Se o dado for um Uint8Array (atualização do Y.js), convertemos para Base64
    if (data instanceof Uint8Array) {
      payloadUpdate = uint8ArrayToBase64(data)
    }

    // Monta o envelope JSON idêntico ao que o receive_json do Django espera
    const envelope = {
      acao: action === 'doc' ? 'sincronizar_arquivo' : action,
      peerId: selfId,// Identifica a origem da mensagem para o roteamento do Django
      uri: metadata?.uri || 'documento_principal', // Identificador do escopo do arquivo
      update: payloadUpdate,
      data: payloadUpdate ? undefined : data, // Dados normais para outras actions
      targetPeers,
      metadata
    }

    socket.send(JSON.stringify(envelope))
  }

  /**
   * Captura as respostas vindas do Django e injeta na árvore local do CRDT
   */
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
      onError.fire('Sessão com o servidor DevOcto finalizada.')
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