import type { ExtensionTerminalOptions, Terminal, TerminalDimensions } from 'vscode'
import type * as Y from 'yjs'
import { effectScope, onScopeDispose, readonly, ref, shallowReactive, useEventEmitter } from 'reactive-vscode'
import { ThemeIcon, window } from 'vscode'

export type TerminalData = Y.Text

export function useShadowTerminals(
  handleInput: (terminalId: string, content: string) => void,
  updateDimension: (terminalId: string, dims: TerminalDimensions) => void,
  onCloseTerminal: (terminalId: string) => void,
) {
  const idToTerminal = shallowReactive(new Map<string, ReturnType<typeof createShadowTerminal>>())

  function createShadowTerminal(id: string, name: string) {
    const scope = effectScope(true)
    const terminal = scope.run(() => {
      let opened = false
      let outputInitialized = false
      let pendingOutput = ''

      const writable = ref(true)
      const outputEmitter = useEventEmitter<string>()
      const overrideDimensionsEmitter = useEventEmitter<TerminalDimensions | undefined>()
      const createOptions: ExtensionTerminalOptions = {
        name,
        iconPath: new ThemeIcon('live-share'),
        pty: {
          ['__LiveShareId' as any]: id,
          onDidWrite: outputEmitter.event,
          onDidOverrideDimensions: overrideDimensionsEmitter.event,
          open(dims: TerminalDimensions) {
            opened = true
            if (pendingOutput) {
              outputEmitter.fire(pendingOutput)
              pendingOutput = ''
            }
            updateDimension(id, dims)
          },
          close() {
            onCloseTerminal(id)
            scope.stop()
          },
          handleInput(content: string) {
            if (writable.value) {
              handleInput(id, content)
            }
          },
          setDimensions(dims: TerminalDimensions) {
            updateDimension(id, dims)
          },
        },
      }

      function appendOutput(content: string) {
        outputInitialized = true
        if (opened) {
          outputEmitter.fire(content)
        }
        else {
          pendingOutput += content
        }
      }

      onScopeDispose(() => {
        const terminalInstance = window.terminals.find(t => extractTerminalId(t) === id)
        if (terminalInstance) {
          terminalInstance.dispose()
        }
      })

      return {
        id,
        createOptions,
        writable,
        createdAt: Date.now(),
        create: () => window.createTerminal(createOptions),
        dispose: () => {
          scope.stop()
          idToTerminal.delete(id)
        },
        initOutput: (output: string) => {
          if (!outputInitialized) {
            appendOutput(output)
          }
        },
        appendOutput,
        overrideDimensions: overrideDimensionsEmitter.fire,
      }
    })!
    idToTerminal.set(id, terminal)
    return terminal
  }

  onScopeDispose(() => {
    for (const terminal of idToTerminal.values()) {
      terminal.dispose()
    }
    idToTerminal.clear()
  })

  return {
    shadowTerminals: readonly(idToTerminal),
    getShadowTerminal(id: string) {
      return idToTerminal.get(id)
    },
    createShadowTerminal,
  }
}

export function extractTerminalId(terminal: Terminal) {
  if (!('pty' in terminal.creationOptions)) {
    return
  }
  const pty = terminal.creationOptions.pty
  if ('__LiveShareId' in pty) {
    const id = pty.__LiveShareId
    if (typeof id === 'string') {
      return id
    }
  }
}
