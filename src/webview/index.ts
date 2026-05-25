import type { Connection, InternalReceiver, InternalSender } from '../sync/connection'
import { createBirpc } from 'birpc'
import { computed, defineService, extensionContext, onScopeDispose, ref, shallowRef, useEventEmitter, useWebviewView, watchEffect } from 'reactive-vscode'
import { commands, Uri } from 'vscode'
import { useActiveSession } from '../session'
import { useUsers } from '../ui/users'
import { logger } from '../utils'

export interface WebviewFunctions {
  updateUIState: (state: UIState) => void
}

export interface ExtensionFunctions {
  share: () => void
  join: (newWindow: boolean | 'auto') => void
  leave: () => void

  getPlatform: () => 'web' | 'desktop'
  getSelfName: () => Promise<string | null>
}
export type UIState = 'none' | 'joining' | {
  role: 'host' | 'guest'
  selfId: string
  hostId: string
  roomId: string
  peers: string[]
}

export const useWebview = defineService(() => {
  const isReady = ref<boolean>(false)
  let onReady: (data: any) => void
  const readyPromise = new Promise<void>(resolve => onReady = (data) => {
    resolve()
    isReady.value = true
  })

  const webviewEvent = useEventEmitter<any>()
  const rpc = createBirpc<WebviewFunctions, ExtensionFunctions>(
    {
      getPlatform() {
        return import.meta.env.TARGET === 'browser' ? 'web' : 'desktop'
      },
      share() {
        useActiveSession().host()
      },
      join(newWindow) {
        useActiveSession().join(newWindow)
      },
      leave() {
        useActiveSession().leave()
      },
      getSelfName() {
        return useUsers().inquireUserName(false)
      },
    },
    {
      post: async (data) => {
        await readyPromise
        const result = await postMessage(data)
        if (!result) {
          logger.error('Failed to post message to webview')
          console.error('Failed to post message to webview')
        }
      },
      on: fn => webviewEvent.event(fn),
    },
  )

  function getAssetUri(fileName: string): Uri {
    return view.value!.webview.asWebviewUri(Uri.joinPath(extensionContext.value!.extensionUri, 'dist', fileName))
  }
  const html = computed(() => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>P2P Connection</title>
    <link rel="stylesheet" href="${getAssetUri('webview.css')}">
    <script type="module" src="${getAssetUri('webview.mjs')}"></script>
</head>
<body>
    <div id="app"></div>
</body>
</html>`)

  // Set up the webview using useWebviewView
  const { postMessage, view } = useWebviewView(
    'p2p-live-share.webview',
    html,
    {
      retainContextWhenHidden: true,
      webviewOptions: {
        enableScripts: true,
      },
      onDidReceiveMessage: (data) => {
        if (data.__webview_ready__) {
          onReady(data)
        }
        else {
          webviewEvent.fire(data)
        }
      },
    },
  )

  function showWebview() {
    commands.executeCommand('p2p-live-share.webview.focus')
    view.value?.show(true)
  }

  async function ensureReady() {
    if (!isReady.value) {
      showWebview()
    }
    await readyPromise
  }


  setTimeout(() => {
    const { state, isJoining } = useActiveSession()
    watchEffect(() => {
      if (isJoining.value) {
        rpc.updateUIState('joining')
      }
      else if (!state.value) {
        rpc.updateUIState('none')
      }
      else {
        rpc.updateUIState({
          role: state.value.role,
          selfId: state.value.connection.selfId,
          hostId: state.value.hostId,
          roomId: state.value.connection.config.roomId,
          peers: state.value.connection.peers.value,
        })
      }
    })
    watchEffect(() => {
      if (view.value) {
        view.value.title = state.value ? 'Sessão' : undefined
      }
    })
  })

  return {
    rpc,
    showWebview,
    ensureReady,
  }
})
