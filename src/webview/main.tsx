
import type { ExtensionFunctions, UIState, WebviewFunctions } from '.'
import * as birpc from 'birpc'
import { createApp, defineComponent, shallowRef } from 'vue'
import Chat, { recvChatMessage } from './components/Chat'
import Welcome from './components/Welcome'
import '@vscode-elements/elements/dist/vscode-button'
import '@vscode-elements/elements/dist/vscode-textarea'


const vscode = acquireVsCodeApi()

export const state = shallowRef<UIState>('joining')

export const rpc = birpc.createBirpc<ExtensionFunctions, WebviewFunctions>(
  {
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
})

createApp(defineComponent(() => {
  return () => typeof state.value === 'object' ? <Chat /> : <Welcome />
})).mount('#app')
