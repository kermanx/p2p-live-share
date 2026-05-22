import type { TerminalDimensions } from 'vscode'
import type * as Y from 'yjs'
import type { Connection } from '../sync/connection.js'
import type { TerminalData } from './common'
import type { ProcessHandle } from './pty/index.js'
import { env } from 'node:process'
import { reactive, useCommand, useDisposable, watchEffect } from 'reactive-vscode'
import { TerminalProfile, window, workspace } from 'vscode'
import { configs } from '../configs'
import { CounterMap, useIdAllocator } from '../utils'
import { useShadowTerminals } from './common'
import { createProcess } from './pty/index.js'

export function useHostTerminals(connection: Connection, doc: Y.Doc) {
  const [send, recv] = connection.makeAction<string, string>('terminal')
  recv((content, _peerId, id) => handleTerminalInput(id!, content))

  const terminalData = doc.getMap<TerminalData>('terminals')
  const processes = new Map<string, ProcessHandle>()
  const allTerminals = new Set<string>()
  const usedNames = new CounterMap<string>()

  const allocId = useIdAllocator()

  const { shadowTerminals, getShadowTerminal, createShadowTerminal } = useShadowTerminals(
    handleTerminalInput,
    (terminal, dims) => {
      const data = terminalData.get(terminal.id)
      if (!data) {
        console.warn('Unknown terminal setDimensions')
        return
      }
      updateShadowTerminalDimensions(connection.selfId, terminal.id, dims)
    },
    (id) => {
      killSharedTerminal(id)
    },
  )

  useDisposable(window.registerTerminalProfileProvider('p2p-live-share.sharedTerminal', {
    async provideTerminalProfile() {
      const { id, terminal } = await createSharedTerminalImpl(connection.selfId)
      allTerminals.add(id)
      return new TerminalProfile(terminal.createOptions)
    },
  }))

  useCommand('p2p-live-share.createSharedTerminal', async () => {
    const { id, terminal } = await createSharedTerminalImpl(connection.selfId)
    terminal.create().show()
    allTerminals.add(id)
  })

  function handleTerminalInput(id: string, content: string) {
    const process = processes.get(id)
    if (!process) {
      console.warn('Unknown terminal input')
      return
    }
    process.write(content)
  }

  async function createSharedTerminalImpl(creator: string) {
    const id = allocId().toString()

    const process = await createProcess({
      cwd: workspace.workspaceFolders?.[0]?.uri.fsPath || workspace.rootPath || env.HOME,
    })
    processes.set(id, process)

    const name = `${process.windowTitle} ${usedNames.inc(process.windowTitle)}`
    const terminal = createShadowTerminal(id, name)

    doc.transact(() => {
      terminalData.set(id, {
        name,
        writable: true,
        creator,
      })
    })

    process.onOutput((data) => {
      terminal.appendOutput(data)
      send(data, null, id)
    })

    return { id, name, terminal }
  }

  const peerDimensions = reactive(new Map<string, Map<string, TerminalDimensions>>())
  function updateShadowTerminalDimensions(peerId: string, terminalId: string, dims: TerminalDimensions) {
    let peerMap = peerDimensions.get(terminalId)
    if (!peerMap) {
      peerDimensions.set(terminalId, peerMap = new Map())
    }
    peerMap.set(peerId, dims)
  }
  watchEffect(() => {
    for (const [id, peerMap] of peerDimensions) {
      // Compute dimensions
      const dims = { columns: Number.NaN, rows: Number.NaN }
      if (configs.terminal.dimensionsSource === 'minimum') {
        for (const peerDims of peerMap.values()) {
          dims.columns = dims.columns ? Math.min(dims.columns, peerDims.columns) : peerDims.columns
          dims.rows = dims.rows ? Math.min(dims.rows, peerDims.rows) : peerDims.rows
        }
      }
      else if (configs.terminal.dimensionsSource === 'maximum') {
        for (const peerDims of peerMap.values()) {
          dims.columns = dims.columns ? Math.max(dims.columns, peerDims.columns) : peerDims.columns
          dims.rows = dims.rows ? Math.max(dims.rows, peerDims.rows) : peerDims.rows
        }
      }
      else if (configs.terminal.dimensionsSource === 'host') {
        const hostDims = peerMap.get(connection.selfId)
        if (hostDims) {
          dims.columns = hostDims.columns
          dims.rows = hostDims.rows
        }
      }
      else if (configs.terminal.dimensionsSource === 'creator') {
        const data = terminalData.get(id)
        if (data) {
          const creatorDims = peerMap.get(data.creator)
          if (creatorDims) {
            dims.columns = creatorDims.columns
            dims.rows = creatorDims.rows
          }
        }
      }
      else {
        console.warn('Unknown terminal dimensionsSource:', configs.terminal.dimensionsSource)
      }

      if (Number.isNaN(dims.columns) || Number.isNaN(dims.rows)) {
        continue
      }

      // Update terminal data
      const data = terminalData.get(id)
      if (!data) {
        console.warn('Unknown terminal setDimensions')
        continue
      }
      const oldDims = data.dimensions
      if (oldDims && oldDims.columns === dims.columns && oldDims.rows === dims.rows) {
        continue
      }
      data.dimensions = dims

      // Update the process dimensions
      const process = processes.get(id)
      if (!process) {
        console.warn('Unknown terminal setDimensions')
        continue
      }
      process.resize(dims.columns, dims.rows)

      // Update local shadow terminal dimensions
      const terminal = getShadowTerminal(id)
      if (terminal) {
        terminal.overrideDimensions(dims)
      }
    }
  })

  function killSharedTerminal(id: string) {
    const process = processes.get(id)
    if (process) {
      process.kill()
      processes.delete(id)
    }
    const terminal = getShadowTerminal(id)
    if (terminal) {
      terminal.dispose()
      allTerminals.delete(id)
    }
    terminalData.delete(id)
  }

  return {
    shadowTerminals,
    async createSharedTerminal(creator: string) {
      const result = await createSharedTerminalImpl(creator)
      result.terminal.create()
      return {
        id: result.id,
        name: result.name,
      }
    },
    updateShadowTerminalDimensions,
    killSharedTerminal,
  }
}
