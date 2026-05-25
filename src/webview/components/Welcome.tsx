import { defineAsyncComponent, defineComponent } from 'vue'
import { rpc, state } from '../main'

export default defineAsyncComponent(async () => {
  
  return defineComponent(() => () => (
    <>
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        Comece a editar colaborativamente com seus colegas e professores em tempo real.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>

              <vscode-button
                onClick={() => {
                  rpc.share()
                  state.value = 'joining'
                }}
                disabled={state.value === 'joining'}
              >
                Compartilhar Workspace
              </vscode-button>

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
