import type { Connection } from '../sync/connection'
import { useDisposable } from 'reactive-vscode'
import { CloseAction, ErrorAction, LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient/browser'
import { ClientUriScheme } from '../fs/provider'
import { useLsConnection } from './common'

export function useClientLs(connection: Connection, hostId: string) {
  const lc = useLsConnection(connection, hostId)

  const client = useDisposable(new LanguageClient(
    'P2PLiveShare',
    'P2PLiveShare Language Client',
    async () => lc,
    {
      documentSelector: [{ scheme: ClientUriScheme }],
      revealOutputChannelOn: RevealOutputChannelOn.Debug,
      middleware: {},
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

  client.start().catch((err) => {
    console.error('Language client start error:', err)
  })
}
