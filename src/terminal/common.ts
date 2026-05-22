import type { ExtensionTerminalOptions, Terminal, TerminalDimensions } from 'vscode'
import { computed, effectScope, onScopeDispose, readonly, ref, shallowReactive, useEventEmitter } from 'reactive-vscode'
import { ThemeIcon, window } from 'vscode'

export interface TerminalData {
  name: string
  writable: boolean
  creator: string
  dimensions?: TerminalDimensions
}

export function useShadowTerminals(
  handleInput: (terminalId: string, content: string) => void,
  updateDimension: (terminal: ReturnType<typeof createShadowTerminal>, dims: TerminalDimensions) => void,
  onCloseTerminal: (terminalId: string) => void,
) {
  const idToTerminal = shallowReactive(new Map<string, ReturnType<typeof createShadowTerminal>>())

  function createShadowTerminal(id: string, name: string) {
    const scope = effectScope(true)
    const terminal = scope.run(() => {
      let opened = false
      let pendingOutput = ''
      let currentDimensions: TerminalDimensions | undefined

      const writable = ref(true)
      const outputEmitter = useEventEmitter<string>()
      const overrideDimensionsEmitter = useEventEmitter<TerminalDimensions | undefined>()
      const createOptions: ExtensionTerminalOptions = {
        name: `${name} [Shared]`,
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
            currentDimensions = dims
            updateDimension(terminal, dims)
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
            currentDimensions = dims
            updateDimension(terminal, dims)
          },
        },
      }

      function appendOutput(content: string) {
        if (opened) {
          outputEmitter.fire(content)
        }
        else {
          pendingOutput += content
        }
      }

      const terminalInstance = computed(() => {
        return window.terminals.find(t => extractTerminalId(t) === id)
      })

      onScopeDispose(() => {
        terminalInstance.value?.dispose()
      })

      return {
        id,
        name,
        createOptions,
        writable,
        createdAt: Date.now(),
        terminalInstance,
        currentDimensions,
        create: () => window.createTerminal(createOptions),
        dispose: () => {
          scope.stop()
          idToTerminal.delete(id)
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
