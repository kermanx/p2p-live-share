import { defineAsyncComponent, defineComponent } from 'vue'
import { rpc, state } from '../main'

export default defineAsyncComponent(async () => {
  const platform = await rpc.getPlatform()
  return defineComponent(() => () => (
    <>
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        Start collaboratively editing with others in real-time.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
        {platform === 'desktop' ? (
          <vscode-button onClick={() => rpc.share()} disabled={state.value === 'joining'}>
            Share
          </vscode-button>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            To share a session, run the extension in VS Code desktop and click "Share".
          </div>
        )}
        <vscode-button onClick={() => rpc.join('auto')} disabled={state.value === 'joining'}>
          Join
        </vscode-button>
      </div>
    </>
  ), { name: 'Welcome' })
})
