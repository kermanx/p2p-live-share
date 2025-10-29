import type { BirpcReturn } from 'birpc'
import type { ClientFunctions, HostFunctions } from '../rpc/types'
import type { TerminalData } from './common'
import { useCommand, useDisposable } from 'reactive-vscode'
import { TerminalProfile, window } from 'vscode'
import * as Y from 'yjs'
import { useActiveSession } from '../session'
import { useObserverDeep } from '../sync/doc'
import { extractTerminalId, useShadowTerminals } from './common'

export function useClientTerminals(doc: Y.Doc, rpc: BirpcReturn<HostFunctions, ClientFunctions>) {
  const { selfId } = useActiveSession()

  const terminalData = doc.getMap<TerminalData>('terminals')
  const createdTerminals = new Set<string>()

  const { shadowTerminals, getShadowTerminal, createShadowTerminal } = useShadowTerminals(
    (id, content) => {
      rpc.handleTerminalInput(id, content)
    },
    (terminal, dims) => {
      if (createdTerminals.has(terminal.id) || terminal.terminalInstance.value?.state.isInteractedWith) {
        rpc.updateShadowTerminalDimensions(selfId.value!, terminal.id, dims)
      }
    },
    (id) => {
      if (createdTerminals.has(id)) {
        rpc.killSharedTerminal(id)
      }
    },
  )

  useDisposable(window.onDidChangeTerminalState((terminal) => {
    const id = extractTerminalId(terminal)
    if (id && terminal.state.isInteractedWith) {
      const shadow = getShadowTerminal(id)
      if (shadow && shadow.currentDimensions) {
        rpc.updateShadowTerminalDimensions(selfId.value!, id, shadow.currentDimensions)
      }
    }
  }))

  useDisposable(window.registerTerminalProfileProvider('p2p-live-share.sharedTerminal', {
    async provideTerminalProfile() {
      const { id, name } = await rpc.createSharedTerminal(selfId.value!)
      const { createOptions } = createShadowTerminal(id, name)
      createdTerminals.add(id)
      return new TerminalProfile(createOptions)
    },
  }))

  useCommand('p2p-live-share.createSharedTerminal', async () => {
    const { id, name } = await rpc.createSharedTerminal(selfId.value!)
    const terminal = createShadowTerminal(id, name)
    terminal.create().show()
    createdTerminals.add(id)
  })

  function syncShadowTerminal(id: string) {
    const data = terminalData.get(id)!
    let terminal = getShadowTerminal(id)
    if (!terminal) {
      if (data.getAttribute('creator') === selfId.value) {
        // This terminal is created by self.
        setTimeout(() => syncShadowTerminal(id), 1000)
        return
      }
      terminal = createShadowTerminal(id, data.getAttribute('name'))
      terminal.create()
    }
    terminal.writable.value = data.getAttribute('writable')
    terminal.overrideDimensions(data.getAttribute('dimensions'))
    terminal.initOutput(data.toString())
  }

  useObserverDeep(
    () => terminalData,
    (events) => {
      for (const event of events) {
        if (event.transaction.local) {
          continue
        }

        if (event.target instanceof Y.Map) {
          for (const [id, { action }] of event.keys) {
            if (action === 'delete') {
              const terminal = getShadowTerminal(id)
              terminal?.dispose()
            }
            else {
              syncShadowTerminal(id)
            }
          }
        }

        else if (event.target instanceof Y.Text) {
          const id = event.path[0] as string
          const terminal = getShadowTerminal(id)
          if (!terminal) {
            console.warn('Unknown terminal changed')
            continue
          }

          const delta = event.delta
          if (delta.length === 0) {
            // noop
          }
          else if (delta.length === 1 && delta[0].insert) {
            const content = delta[0].insert as string
            terminal.appendOutput(content)
          }
          else if (delta.length === 2 && delta[0].retain && delta[1].insert) {
            const content = delta[1].insert as string
            terminal.appendOutput(content)
          }
          else {
            console.warn('Unsupported terminal change delta', delta)
          }

          if (event.keys.has('dimensions')) {
            const dimension = event.target.getAttribute('dimensions')
            terminal.overrideDimensions(dimension)
          }
          if (event.keys.has('writable')) {
            const writable = event.target.getAttribute('writable')
            terminal.writable.value = writable
          }
        }
      }
    },
    (terminalData) => {
      for (const id of terminalData.keys()) {
        syncShadowTerminal(id)
      }
    },
  )

  return {
    shadowTerminals,
  }
}
