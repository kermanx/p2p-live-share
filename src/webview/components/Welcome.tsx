import { defineAsyncComponent, defineComponent } from 'vue'
import { rpc, state } from '../main'

export default defineAsyncComponent(async () => {
  const platform = await rpc.getPlatform()
  return defineComponent(() => () => (
    <>
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        Comece a editar colaborativamente com seus colegas e professores em tempo real.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
        {platform === 'desktop'
          ? (
              <vscode-button
                onClick={() => {
                  rpc.share()
                  state.value = 'joining'
                }}
                disabled={state.value === 'joining'}
              >
                Compartilhar Workspace
              </vscode-button>
            )
          : (
              <div style={{ marginBottom: '16px' }}>
                To share a session, run the extension in VS Code desktop and click "Share".
              </div>
            )}
        <vscode-button
          onClick={() => {
            rpc.join('auto')
            state.value = 'joining'
          }}
          disabled={state.value === 'joining'}
        >
          Entrar
        </vscode-button>
      </div>
    </>
  ), { name: 'Welcome' })
})
