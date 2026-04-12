import type { InitializeParams } from 'vscode-languageclient/browser'
import type { Connection } from '../sync/connection'
import { useCommand, useDisposable } from 'reactive-vscode'
import { CloseAction, ErrorAction, LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient/browser'
import { CustomUriScheme } from '../fs/provider'
import { ExecuteHostCommand, useLsConnection } from './common'

class PatchedLanguageClient extends LanguageClient {
  protected fillInitializeParams(params: InitializeParams): void {
    super.fillInitializeParams(params)
    params.processId = null
  }
}

export function useGuestLs(connection: Connection, hostId: string) {
  const lc = useLsConnection(connection, hostId)

  const languageClient = useDisposable(new PatchedLanguageClient(
    'P2PLiveShare',
    'P2P Live Share Language Client',
    async () => lc,
    {
      documentSelector: [{ scheme: CustomUriScheme }],
      revealOutputChannelOn: RevealOutputChannelOn.Debug,
      middleware: {
      },
      errorHandler: {
        error: (error, message, count) => {
          console.error('Language client error:', { error, message, count })
          return { action: ErrorAction.Continue }
        },
        closed: () => {
          console.warn('Language client closed')
          return { action: CloseAction.DoNotRestart }
        },
      },
    },
  ))

  languageClient.start().catch((err) => {
    console.error('Language client start error:', err)
  })

  useCommand(ExecuteHostCommand, () => {
    // Do nothing
  })
}
