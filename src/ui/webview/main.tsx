import type * as trystero from 'trystero'
import type { ExtensionFunctions, UIState, WebviewFunctions } from './webview'
import * as birpc from 'birpc'
import * as mqtt from 'trystero/mqtt'
import * as nostr from 'trystero/nostr'
import { createApp, defineComponent, shallowRef } from 'vue'
import Chat, { recvChatMessage } from './components/Chat'
import Welcome from './components/Welcome'
import '@vscode-elements/elements/dist/vscode-button'
import '@vscode-elements/elements/dist/vscode-textarea'

// @ts-expect-error global function
const vscode = acquireVsCodeApi()

export const state = shallowRef<UIState>('joining')

let trysteroRoom: trystero.Room | null = null
const trysteroSenders = new Map<string, trystero.ActionSender<trystero.DataPayload>>()

export const rpc = birpc.createBirpc<ExtensionFunctions, WebviewFunctions>(
  {
    async trysteroJoinRoom(strategy, config, roomId) {
      const trystero = strategy === 'nostr' ? nostr : strategy === 'mqtt' ? mqtt : null

      if (!trystero) {
        throw new Error(`Unknown strategy: ${strategy}`)
      }

      // @ts-expect-error wrong types
      const room = trystero.joinRoom(config, roomId, ({ error }) => rpc.onTrysteroError(error))
      trysteroRoom = room

      const updatePeers = () => rpc.onTrysteroUpdatePeers(Object.keys(room.getPeers()))
      room.onPeerJoin(updatePeers)
      room.onPeerLeave(updatePeers)
      updatePeers()
    },
    async trysteroSend(action, ...args) {
      await makeAction(action)(...args)
    },
    trysteroListenAction(action) {
      makeAction(action)
    },
    trysteroLeaveRoom() {
      if (trysteroRoom) {
        trysteroRoom.leave()
        trysteroRoom = null
        trysteroSenders.clear()
      }
    },
    recvChatMessage,
    updateUIState(s) {
      state.value = s
    },
  },
  {
    post: data => vscode.postMessage(data),
    on: fn => window.addEventListener('message', event => fn(event.data)),
  },
)

vscode.postMessage({
  __webview_ready__: true,
  trysteroSelfId: nostr.selfId,
})

createApp(defineComponent(() => {
  return () => typeof state.value === 'object' ? <Chat /> : <Welcome />
})).mount('#app')

function makeAction(action: string) {
  if (!trysteroRoom) {
    throw new Error('Not in a room')
  }
  const sender = trysteroSenders.get(action)
  if (sender) {
    return sender
  }
  const [send, recv] = trysteroRoom.makeAction(action)
  trysteroSenders.set(action, send)
  recv((...args) => rpc.onTrysteroMessage(action, ...args))
  return send
}
