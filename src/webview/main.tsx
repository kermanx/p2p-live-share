import type { ExtensionFunctions, UIState, WebviewFunctions } from '.'
import * as birpc from 'birpc'
import { createApp, defineComponent, shallowRef } from 'vue'

import Welcome from './components/Welcome'
import '@vscode-elements/elements/dist/vscode-button'

const vscode = acquireVsCodeApi()

export const state = shallowRef<UIState>('joining')

export const rpc = birpc.createBirpc<ExtensionFunctions, WebviewFunctions>(
  {
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
  return () => {
    if (typeof state.value === 'object') {
      const isHost = state.value.role === 'host'
      return (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px', color: 'var(--vscode-foreground)' }}>
            Sessão Ativa
          </div>
          <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Sala: <span style={{ color: 'var(--vscode-textLink-foreground)', fontWeight: 'bold' }}>{state.value.roomId}</span>
          </div>
          <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Papel: <span style={{ color: 'var(--vscode-foreground)' }}>{isHost ? 'Professor' : 'Aluno'}</span>
          </div>
          <div style={{ marginTop: '12px' }}>
            <vscode-button 
              style={{ width: '100%' }}
              onClick={() => rpc.leave()}
            >
              {isHost ? 'Encerrar Compartilhamento' : 'Sair da Aula'}
            </vscode-button>
          </div>
        </div>
      )
    }
    return <Welcome />
  }
})).mount('#app')