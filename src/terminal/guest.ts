import type { BirpcReturn } from 'birpc'
import type * as Y from 'yjs'
import type { GuestFunctions, HostFunctions } from '../rpc/types'
import type { Connection } from '../sync/connection'
import type { TerminalData } from './common'
import { useCommand, useDisposable } from 'reactive-vscode'
import { TerminalProfile, window } from 'vscode'
import { useObserverShallow } from '../sync/doc'
import { extractTerminalId, useShadowTerminals } from './common'

export function useGuestTerminals(connection: Connection, doc: Y.Doc, rpc: BirpcReturn<HostFunctions, GuestFunctions>, hostId: string) {
  const [send, recv] = connection.makeAction<string, string>('terminal')
  recv((content, _peerId, id) => {
    const terminal = getShadowTerminal(id!)
    if (terminal) {
      terminal.appendOutput(content)
    }
  })

  const terminalData = doc.getMap<TerminalData>('terminals')
  const createdTerminals = new Set<string>()

  const { shadowTerminals, getShadowTerminal, createShadowTerminal } = useShadowTerminals(
    (id, content) => {
      send(content, hostId, id)
    },
    (terminal, dims) => {
      if (createdTerminals.has(terminal.id) || terminal.terminalInstance.value?.state.isInteractedWith) {
        rpc.updateShadowTerminalDimensions(connection.selfId, terminal.id, dims)
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
        rpc.updateShadowTerminalDimensions(connection.selfId, id, shadow.currentDimensions)
      }
    }
  }))

  useDisposable(window.registerTerminalProfileProvider('p2p-live-share.sharedTerminal', {
    async provideTerminalProfile() {
      const { id, name } = await rpc.createSharedTerminal(connection.selfId)
      const { createOptions } = createShadowTerminal(id, name)
      createdTerminals.add(id)
      return new TerminalProfile(createOptions)
    },
  }))

  useCommand('p2p-live-share.createSharedTerminal', async () => {
    const { id, name } = await rpc.createSharedTerminal(connection.selfId)
    const terminal = createShadowTerminal(id, name)
    terminal.create().show()
    createdTerminals.add(id)
  })

  function syncShadowTerminal(id: string) {
    const data = terminalData.get(id)!
    let terminal = getShadowTerminal(id)
    if (!terminal) {
      if (data.creator === connection.selfId) {
        // This terminal is created by self.
        setTimeout(() => syncShadowTerminal(id), 1000)
        return
      }
      terminal = createShadowTerminal(id, data.name)
      terminal.create()
    }
    terminal.writable.value = data.writable
    terminal.overrideDimensions(data.dimensions)
  }

  useObserverShallow(() => terminalData, (event) => {
    if (event.transaction.local) {
      return
    }

    for (const [id, { action }] of event.keys) {
      if (action === 'delete') {
        const terminal = getShadowTerminal(id)
        terminal?.dispose()
      }
      else {
        syncShadowTerminal(id)
      }
    }
  }, (terminalData) => {
    for (const id of terminalData.keys()) {
      syncShadowTerminal(id)
    }
  })

  return {
    shadowTerminals,
  }
}
