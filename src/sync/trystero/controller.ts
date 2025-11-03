import type { Ref } from 'reactive-vscode'
import type { JsonValue } from 'trystero'
import type { InternalReceiver, InternalSender } from '../connection'
import { onScopeDispose, watchEffect } from 'reactive-vscode'
import { MapWithDefault, ThrottledExecutor } from '../../utils'

const ResendTimeout = 2000
const AckInterval = 200

export const AckActionName = '_ack'

interface MessageMetadata {
  gsn?: number
  jsonData?: any
  metadata?: JsonValue
}

interface AckData {
  applied: number
  received: number[]
}

interface SendingState {
  sentAt: number
  action: string
  data: Uint8Array
  metadata: MessageMetadata
}

interface PeerState {
  sendGsn: number
  sending: Map<number, SendingState>

  lastApplied: number
  lastSeen: number
  receiving: Map<number, {
    action: string
    data: Uint8Array
    metadata: JsonValue | undefined
  }>

  ackExecutor: ThrottledExecutor
}

export function useSyncController(
  peerIds: Ref<string[]>,
  send: InternalSender,
  recv: InternalReceiver,
): {
  send: InternalSender
  recv: InternalReceiver
} {
  const peers = new MapWithDefault<string, PeerState>(() => ({
    sendGsn: 1,
    sending: new Map(),
    lastApplied: 0,
    lastSeen: Date.now(),
    receiving: new Map(),
    ackExecutor: new ThrottledExecutor(AckInterval),
  }))
  watchEffect(() => {
    for (const peerId of peers.keys()) {
      if (!peerIds.value.includes(peerId)) {
        peers.delete(peerId)
      }
    }
  })

  let checking = false
  async function intervalCheck() {
    if (checking) {
      console.warn('Resend check is already running, skipping this interval')
      return
    }
    checking = true
    await Promise.allSettled([...peers.keys()].map(async (peerId) => {
      const { sending } = peers.use(peerId)
      for (const [gsn, state] of sending) {
        if (state.sentAt && Date.now() - state.sentAt > ResendTimeout) {
          try {
            await sendImpl(peerId, state)
          }
          catch {
            console.error('Failed to resend message', peerId, gsn)
            sending.delete(gsn)
          }
        }
      }
    }))
    checking = false
  }
  const intervalId = setInterval(intervalCheck, 2000)
  onScopeDispose(() => clearInterval(intervalId))

  async function sendImpl(peerId: string, state: SendingState) {
    try {
      await send(state.action, state.data, peerId, state.metadata)
    }
    finally {
      state.sentAt = Date.now()
    }
  }

  return {
    async send(action, data, targetPeers_, metadata) {
      const isInternal = action.startsWith('__')
      const targetPeers = targetPeers_ ? Array.isArray(targetPeers_) ? targetPeers_ : [targetPeers_] : peers.keys()
      for (const peerId of targetPeers) {
        const peer = peers.use(peerId)
        const gsn = isInternal ? undefined : peer.sendGsn++
        const isBinary = data instanceof Uint8Array
        const sendingState: SendingState = {
          sentAt: Number.NaN,
          action,
          data: isBinary ? data : new Uint8Array(),
          metadata: {
            gsn,
            jsonData: isBinary ? undefined : data,
            metadata,
          },
        }

        if (gsn !== undefined) {
          peer.sending.set(gsn, sendingState)
        }

        await sendImpl(peerId, sendingState)
      }
    },
    recv(action, data, peerId, metadata_) {
      const peer = peers.use(peerId)
      peer.lastSeen = Date.now()
      const { sending, receiving } = peer
      if (action === AckActionName) {
        const { applied, received } = data as AckData
        for (const gsn of sending.keys()) {
          if (applied >= gsn || received.includes(gsn)) {
            sending.delete(gsn)
          }
        }
      }
      else {
        const { gsn, jsonData, metadata } = metadata_ as MessageMetadata
        data = jsonData === undefined ? data : jsonData

        if (!gsn) {
          // No acknowledgment needed
          recv(action, data, peerId, metadata)
          return
        }

        if (gsn > peer.lastApplied) {
          receiving.set(gsn, { action, data, metadata })
          while (true) {
            const data = receiving.get(peer.lastApplied + 1)
            if (!data) {
              break
            }
            peer.lastApplied++
            receiving.delete(peer.lastApplied)
            try {
              recv(data.action, data.data, peerId, data.metadata)
            }
            catch (error) {
              console.error('Error applying received message', error)
            }
          }
        }

        peer.ackExecutor.schedule(() => {
          send(AckActionName, {
            applied: peer.lastApplied,
            received: [...receiving.keys()],
          }, peerId)
        })

        if (receiving.size > 0) {
          console.warn(`data packs from ${peerId} not applied:`, [...receiving.keys()])
        }
      }
    },
  }
}
