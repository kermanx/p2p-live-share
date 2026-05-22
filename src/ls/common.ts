import type { MessageReader, MessageWriter } from 'vscode-languageserver/browser'
import type { Connection } from '../sync/connection'
import { useEventEmitter } from 'reactive-vscode'
import { logger } from '../utils'

export function useLsConnection(connection: Connection, peerId: string) {
  const [sendLsData, recvLsData] = connection.makeAction('ls')

  const onError = useEventEmitter<any>()
  const onClose = useEventEmitter<any>()
  const onPartialMessage = useEventEmitter<any>()

  const reader: MessageReader = {
    onError: onError.event,
    onClose: onClose.event,
    onPartialMessage: onPartialMessage.event,
    listen(callback) {
      recvLsData((data, peerId_, _metadata) => {
        if (peerId_ !== peerId) {
          logger.warn('ls connection peerId mismatch', peerId_, peerId)
          return
        }
        callback(data)
      })
      return {
        dispose() {},
      }
    },
    dispose() { },
  }
  const writer: MessageWriter = {
    onError: onError.event,
    onClose: onClose.event,
    async write(msg) {
      await sendLsData(msg, peerId)
    },
    end() { },
    dispose() { },
  }

  return {
    reader,
    writer,
  }
}

export const ExecuteHostCommand = 'p2p-live-share.executeHostCommand'
