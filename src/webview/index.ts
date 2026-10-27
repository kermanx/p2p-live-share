import type * as trystero from 'trystero'
import type { Connection, InternalReceiver, InternalSender } from '../sync/connection'
import type { ChatMessage } from './components/Chat'
import { createBirpc } from 'birpc'
import { computed, defineService, extensionContext, onScopeDispose, ref, shallowRef, useEventEmitter, useWebviewView, watch, watchEffect } from 'reactive-vscode'
import { commands, Uri } from 'vscode'
import { useActiveSession } from '../session'
import { useUsers } from '../ui/users'
import { logger } from '../utils'

export interface WebviewFunctions {
  trysteroJoinRoom: (
    strategy: string,
    config: trystero.BaseRoomConfig & trystero.RelayConfig & trystero.TurnConfig,
    roomId: string,
  ) => void
  trysteroSend: InternalSender
  trysteroListenAction: (action: string) => void
  trysteroLeaveRoom: () => void

  recvChatMessage: (message: ChatMessage | ChatMessage[] | 'clear') => void
  updateUIState: (state: UIState) => void
}

export interface TrysteroHandlers {
  onTrysteroClose: () => void
  onTrysteroError: (message: string) => void
  onTrysteroUpdatePeers: (peers: string[]) => void
  onTrysteroMessage: InternalReceiver
}

export interface ExtensionFunctions extends Omit<TrysteroHandlers, 'onTrysteroClose'> {
  share: () => void
  join: (newWindow: boolean | 'auto') => void
  leave: () => void

  getPlatform: () => 'web' | 'desktop'
  sendChatMessage: (content: any) => void
  ping: (peerId: string) => Promise<number>
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
  const trysteroHandlers = shallowRef<TrysteroHandlers | null>(null)

  const isReady = ref<{ trysteroSelfId: string } | null>(null)
  let resolveReady: () => void
  function waitForReady() {
    return new Promise<void>(resolve => resolveReady = resolve)
  }
  let readyPromise = waitForReady()
  let chatMessages: ChatMessage[] = []

  const webviewEvent = useEventEmitter<any>()
  const rpc = createBirpc<WebviewFunctions, ExtensionFunctions>(
    {
      getPlatform() {
        return import.meta.env.TARGET === 'browser' ? 'web' : 'desktop'
      },
      onTrysteroError(message) {
        trysteroHandlers.value?.onTrysteroError(message)
      },
      onTrysteroUpdatePeers(peers) {
        trysteroHandlers.value?.onTrysteroUpdatePeers(peers)
      },
      onTrysteroMessage(...args) {
        trysteroHandlers.value?.onTrysteroMessage(...args)
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
      sendChatMessage(content) {
        if (sendChatMessage.value) {
          chatMessages.push(content)
          sendChatMessage.value(content)
        }
      },
      async ping(peerId) {
        const { connection } = useActiveSession()
        return connection.value!.ping(peerId)
      },
      getSelfName() {
        return useUsers().inquireUserName(false)
      },
    },
    {
      post: async (data) => {
        while (!isReady.value) {
          await readyPromise
        }
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
      onDidDispose: () => {
        isReady.value = null
        resolveReady()
        readyPromise = waitForReady()
        // Trystero's WebRTC connections live in the destroyed webview.
        trysteroHandlers.value?.onTrysteroClose()
      },
      onDidReceiveMessage: (data) => {
        if (data.__webview_ready__) {
          isReady.value = data
          resolveReady()
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
    while (!isReady.value) {
      await readyPromise
    }
  }

  const sendChatMessage = ref<(content: any) => void>()
  function useChat(connection: Connection) {
    const [send, recv] = connection.makeAction<ChatMessage>('chat')
    sendChatMessage.value = send
    recv((message) => {
      chatMessages.push(message)
      if (isReady.value) {
        rpc.recvChatMessage.asEvent(message)
      }
    })
    onScopeDispose(() => {
      sendChatMessage.value = undefined
      chatMessages = []
      if (isReady.value) {
        rpc.recvChatMessage.asEvent('clear')
      }
    })
  }

  setTimeout(() => {
    const { state, isJoining } = useActiveSession()
    watch(isReady, (ready) => {
      if (ready) {
        rpc.recvChatMessage.asEvent(chatMessages)
      }
    }, { immediate: true })
    watchEffect(() => {
      if (!isReady.value) {
        return
      }
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
  })

  return {
    rpc,
    trysteroHandlers,
    get trysteroSelfId() {
      return isReady.value!.trysteroSelfId
    },
    showWebview,
    ensureReady,
    useChat,
  }
})
