import type { Ref } from 'reactive-vscode'
import type { TargetPeers } from 'trystero'
import type { Event } from 'vscode'
import type { ConnectionConfig } from './share'
import { nanoid } from 'nanoid'
import { Uri, window, workspace } from 'vscode'
import { onSessionClosed } from '../session'
import { normalizeUint8Array } from '../utils'
import { makeTrackUri, parseTrackUri } from './share'
import { useSteroConnection } from './trystero'
import { useWebSocketConnection } from './ws/client'
import { useWebSocketHostConnection } from './ws/host'

export type { TargetPeers } from 'trystero'

export type JsonValue = null | boolean | number | string | any[] | { [key: string]: any }
export type DataPayload = JsonValue | Uint8Array
export type Sender<T extends DataPayload = any, M extends JsonValue = any> = (data: T, targetPeers?: TargetPeers, metadata?: M) => Promise<void>
export type Receiver<T extends DataPayload = any, M extends JsonValue = any> = (data: T, peerId: string, metadata?: M) => void

export type InternalSender = (action: string, ...args: Parameters<Sender>) => Promise<void>
export type InternalReceiver = (action: string, ...args: Parameters<Receiver>) => void

export interface InternalConnection {
  readonly selfId: string
  readonly ready: Promise<void>
  peers: Ref<string[]>
  listenMessage: (action: string) => void
  sendMessage: InternalSender
  onMessage: Event<Parameters<InternalReceiver>>
  onError: Event<string>
  onClose: Event<void>
}

export function useConnection(config: ConnectionConfig) {
  let internal: InternalConnection
  if (config.type === 'ws' || config.type === 'wss') {
    internal = useWebSocketConnection(config)
  }
  else if (config.type === 'local') {
    internal = useWebSocketHostConnection(config)
  }
  else if (config.type === 'trystero') {
    internal = useSteroConnection(config)
  }
  else {
    throw new Error(`Unknown connection type: ${config.type}`)
  }

  const receivers: Record<string, Receiver> = {}
  internal.onMessage(([action, data, peerId, metadata]) => {
    receivers[action]?.(data, peerId, metadata)
  })

  function makeAction<T extends DataPayload = any, M extends JsonValue = any>(action: string) {
    internal.ready.then(() => internal.listenMessage(action))
    return [
      (data: T, targetPeers?: TargetPeers, metadata?: M) => {
        // Development-only checks
        if (import.meta.env.NODE_ENV === 'development') {
          if (metadata && !(data instanceof Uint8Array)) {
            throw new Error('Trystero only supports metadata when data is binary')
          }
          const nameBytes = new TextEncoder().encode(action)
          if (nameBytes.length > 12) {
            throw new Error('Trystero only supports action names up to 12 bytes')
          }
        }

        if (data instanceof Uint8Array) {
          data = normalizeUint8Array(data)
        }
        return internal.sendMessage(action, data, targetPeers, metadata)
      },
      (receiver: Receiver<T, M>) => {
        const oldReceiver = receivers[action]
        if (oldReceiver) {
          receivers[action] = (data, peerId, metadata) => {
            oldReceiver(data, peerId, metadata)
            receiver(data, peerId, metadata)
          }
        }
        else {
          receivers[action] = receiver
        }
      },
    ] as const
  }

  internal.onError((err) => {
    console.error('P2P Connection Error:', err)
    window.showErrorMessage(`Connection Error: ${err}`)
  })

  internal.onClose(() => {
    onSessionClosed({
      title: 'P2P Live Share: Connection closed.',
      detail: 'The connection has been closed. This may be due to network issues or the relay server going offline.',
    })
  })

  const [sendPing, recvPing] = makeAction<string>('__ping__')
  const [sendPong, recvPong] = makeAction<string>('__pong__')
  const activePings = new Map<string, {
    key: string
    start: number
    resolve: (value: number) => void
  }>()
  recvPing(sendPong)
  recvPong((key_, peerId) => {
    const ping = activePings.get(peerId)
    if (ping && ping.key === key_) {
      ping.resolve(Date.now() - ping.start)
      activePings.delete(peerId)
    }
  })

  return {
    config,
    selfId: internal.selfId,
    peers: internal.peers,
    ready: internal.ready,
    makeAction,
    ping(peerId: string) {
      return Promise.race([
        new Promise<number>((resolve) => {
          const key = nanoid()
          activePings.set(peerId, {
            key,
            start: Date.now(),
            resolve,
          })
          sendPing(key, peerId)
        }),
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(Number.POSITIVE_INFINITY), 10000)
        }),
      ])
    },
    toTrackUri(uri: Uri) {
      return makeTrackUri(config, uri)
    },
    toHostUri(uri: Uri) {
      const parsed = parseTrackUri(uri)
      if (!parsed) {
        throw new Error(`Invalid URI: ${uri.toString()}`)
      }
      const folder = workspace.workspaceFolders?.[parsed.workspace]
      if (!folder) {
        throw new Error(`Invalid workspace index: ${parsed.workspace}`)
      }
      return Uri.joinPath(folder.uri, parsed.path)
    },
  }
}

export type Connection = ReturnType<typeof useConnection>
