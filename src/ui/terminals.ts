import { computed, createSingletonComposable, useCommand, useTreeView } from 'reactive-vscode'
import { ThemeIcon, window } from 'vscode'
import { useActiveSession } from '../session'
import { extractTerminalId } from '../terminal/common'

export const useTerminalsTree = createSingletonComposable(() => {
  const { shadowTerminals } = useActiveSession()

  const sortedTerminals = computed(() => {
    if (!shadowTerminals.value) {
      return []
    }
    return Array.from(shadowTerminals.value.values()).sort((a, b) => a.createdAt - b.createdAt)
  })

  useCommand('p2p-live-share.focusSharedTerminal', (terminalId: string) => {
    const terminal = terminalId && window.terminals.find(t => extractTerminalId(t) === terminalId)
    if (!terminal) {
      window.showWarningMessage('Cannot find shared terminal.')
      return
    }
    terminal.show()
  })
  useCommand('p2p-live-share.closeSharedTerminal', (item?: any) => {
    const terminalId = item?.treeItem?.terminalId
    const terminal = terminalId ? shadowTerminals.value?.get(terminalId) : null
    if (!terminal) {
      window.showWarningMessage('Cannot find shared terminal.')
      return
    }
    terminal.dispose()
  })

  useTreeView(
    'p2p-live-share.terminals',
    () => sortedTerminals.value.map((terminal) => {
      const label = terminal.createOptions.name.slice(0, -' [shared]'.length)

      return {
        treeItem: {
          iconPath: new ThemeIcon('terminal'),
          label,
          terminal,
          command: {
            title: 'Focus Shared Terminal',
            command: 'p2p-live-share.focusSharedTerminal',
            arguments: [terminal.id],
          },
          terminalId: terminal.id,
        },
      }
    }),
  )
})
