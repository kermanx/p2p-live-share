import { defineComponent } from 'vue'
import { rpc, state } from '../main'

export default defineComponent(() => {
  return () => (
    <>
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        Start collaboratively editing with others in real-time.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
        <vscode-button onClick={() => rpc.share()} disabled={state.value === 'joining'}>
          Share
        </vscode-button>
        <vscode-button onClick={() => rpc.join('auto')} disabled={state.value === 'joining'}>
          Join
        </vscode-button>
      </div>
    </>
  )
}, { name: 'Welcome' })
