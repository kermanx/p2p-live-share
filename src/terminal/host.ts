import type { TerminalDimensions } from 'vscode'
import type { TerminalData } from './common'
import type { ProcessHandle } from './pty/index.js'
import { env } from 'node:process'
import { useCommand, useDisposable } from 'reactive-vscode'
import { TerminalProfile, window, workspace } from 'vscode'
import * as Y from 'yjs'
import { useActiveSession } from '../session'
import { useIdAllocator } from '../utils'
import { useShadowTerminals } from './common'
import { createProcess } from './pty/index.js'

export function useHostTerminals(doc: Y.Doc) {
  const { selfId } = useActiveSession()

  const terminalData = doc.getMap<TerminalData>('terminals')
  const processes = new Map<string, ProcessHandle>()
  const createdTerminals = new Set<string>()

  const allocId = useIdAllocator()

  const { shadowTerminals, getShadowTerminal, createShadowTerminal } = useShadowTerminals(
    handleTerminalInput,
    (id, dims) => {
      const data = terminalData.get(id)
      if (!data) {
        console.warn('Unknown terminal setDimensions')
        return
      }
      if (createdTerminals.has(id)) {
        setDimensions(id, dims)
        data.setAttribute('dimension', dims)
      }
    },
    (id) => {
      if (createdTerminals.has(id)) {
        killSharedTerminal(id)
      }
    },
  )

  useDisposable(window.registerTerminalProfileProvider('p2p-live-share.sharedTerminal', {
    async provideTerminalProfile() {
      const { id, terminal } = await createSharedTerminalImpl(selfId.value!)
      createdTerminals.add(id)
      return new TerminalProfile(terminal.createOptions)
    },
  }))

  useCommand('p2p-live-share.createSharedTerminal', async () => {
    const { id, terminal } = await createSharedTerminalImpl(selfId.value!)
    terminal.create().show()
    createdTerminals.add(id)
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

    const name = `${process.windowTitle} [Shared]`
    const terminal = createShadowTerminal(id, name)

    const text = new Y.Text()
    text.setAttribute('name', name)
    text.setAttribute('writable', true)
    text.setAttribute('creator', creator)
    terminalData.set(id, text)

    process.onOutput((data) => {
      terminal.appendOutput(data)
      doc.transact(() => {
        text.insert(text.length, data)
      })
    })

    return { id, name, terminal }
  }

  function setDimensions(id: string, dims: TerminalDimensions) {
    const process = processes.get(id)
    if (!process) {
      console.warn('Unknown terminal setDimensions')
      return
    }
    process.resize(dims.columns, dims.rows)
    const terminal = getShadowTerminal(id)
    if (terminal) {
      terminal.overrideDimensions(dims)
    }
  }

  function killSharedTerminal(id: string) {
    const process = processes.get(id)
    if (process) {
      process.kill()
      processes.delete(id)
    }
    const terminal = getShadowTerminal(id)
    if (terminal) {
      terminal.dispose()
      createdTerminals.delete(id)
    }
    terminalData.delete(id)
  }

  return {
    shadowTerminals,
    async createSharedTerminal(creator: string) {
      const result = await createSharedTerminalImpl(creator)
      result.terminal.create()
      return result
    },
    setDimensions,
    killSharedTerminal,
    handleTerminalInput,
  }
}
