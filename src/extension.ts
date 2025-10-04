import { defineExtension } from 'reactive-vscode'
import { useFsProvider } from './fs/provider'
import { useActiveSession } from './session'
import { useParticipantsTree } from './ui/participants'
import { useSelections } from './ui/selections'
import { useTerminalsTree } from './ui/terminals'
import { useTunnelsTree } from './ui/tunnels'
import { useWebview } from './ui/webview/webview'
import { logger } from './utils'

export const { activate, deactivate } = defineExtension(() => {
  logger.info('Extension Activated')

  useActiveSession()
  useWebview()
  useFsProvider()
  useSelections()
  useParticipantsTree()
  useTerminalsTree()
  useTunnelsTree()
})
