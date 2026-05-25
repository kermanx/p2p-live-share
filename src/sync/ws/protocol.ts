import type { DataPayload, JsonValue, TargetPeers } from '../connection'
import type { Ref } from 'reactive-vscode'
import { pack, unpack } from 'msgpackr'
import { logger } from '../../utils'
export interface UplinkMessageContent {
  acao: string         // Mantendo o padrão em português que colocamos no Django
  uri?: string
  update?: Uint8Array       //
  targetPeers?: TargetPeers
  metadata?: JsonValue
}

export interface DownlinkMessageContent {
  acao: string
  uri?: string
  update?: Uint8Array       // 
  peerId: string
  metadata?: JsonValue
}

export function createWsSender(socket: WebSocket, selfId: string, isClosed: () => boolean) {
  return async function sendMessage(action: string, data: any, targetPeers?: TargetPeers, metadata?: any) {
    if (isClosed()) {
      throw new Error('WebSocket fechado')
    }

    if (data instanceof Uint8Array || action === 'doc') {
      const envelope = {
        acao: action === 'doc' ? 'sincronizar_arquivo' : action,
        peerId: selfId,
        uri: metadata?.uri || 'documento_principal',
        update: data,
        targetPeers,
        metadata
      }
      socket.send(pack(envelope))
      return
    }

    const jsonEnvelope = {
      acao: action,
      peerId: selfId,
      data: data,
      targetPeers,
      metadata
    }
    socket.send(JSON.stringify(jsonEnvelope))
  }
}

export function handleWsMessage(
  event: MessageEvent,
  selfId: string,
  peers: Ref<string[]>,
  onMessageFire: (args: Parameters<InternalReceiver>) => void
) {
  try {
    if (typeof event.data === 'string') {
      const conteudo = JSON.parse(event.data)
      
      if (conteudo.acao === UpdatePeersAction) {
        peers.value = (conteudo.data as string[]).filter((id: string) => id !== selfId)
        return
      }

      onMessageFire([conteudo.acao, conteudo.data, conteudo.peerId, conteudo.metadata])
      return
    }

    if (event.data instanceof ArrayBuffer) {
      const conteudo = unpack(new Uint8Array(event.data))
      const metaPura = conteudo.metadata === null ? undefined : conteudo.metadata
      
      if (conteudo.acao === 'atualizar_arquivo' && conteudo.update instanceof Uint8Array) {
        onMessageFire(['doc', conteudo.update, conteudo.peerId || 'servidor', metaPura])
        return
      }

      if (conteudo.update instanceof Uint8Array) {
        onMessageFire([conteudo.acao, conteudo.update, conteudo.peerId, metaPura])
        return
      }
    }
  } catch (err) {
    logger.error('Erro ao rotear pacote no WebSocket:', err)
  }
}

export const UpdatePeersAction = '__update_peers__'
export const UpdatePermissionsAction = 'p2p-upd-perms'
export const UpdateGlobalLockAction = 'p2p-upd-global-lock'
export const ForceSyncAction = 'p2p-force-sync'