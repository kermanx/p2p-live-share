import type { BirpcReturn } from 'birpc'
import type { ClientFunctions, HostFunctions } from '../rpc/types'
import type { Connection } from '../sync/connection'
import type { FileChangeEvent } from './common'
import { computed, defineConfig, useDisposable } from 'reactive-vscode'
import { Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { forceUpdateContent, handleFsError, setupTextDocumentUpdater, useTextDocumentWatcher } from './common'
import { ClientUriScheme, useFsProvider } from './provider'

const filesConfig = defineConfig<any>('files')

export function useClientFs(connection: Connection, rpc: BirpcReturn<HostFunctions, ClientFunctions>, hostId: string) {
  const { fileChanged, useSetActiveProvider } = useFsProvider()

  const files = new Map<string, Y.Doc>()
  const [send, recv] = connection.makeAction<Uint8Array, string>('texts')

  recv((update, peerId, uri) => {
    const file = files.get(uri!)
    if (file)
      Y.applyUpdateV2(file, update, { peerId })
  })

  async function trackContent(uri: string) {
    const doc = new Y.Doc()
    const init = await rpc.trackContent({ clientId: connection.selfId, uri })
    Y.applyUpdateV2(doc, init)
    files.set(uri, doc)

    doc.on('updateV2', async (update: Uint8Array, origin: any) => {
      if (origin?.peerId)
        return
      await send(update, hostId, uri)
    })
    setupTextDocumentUpdater(Uri.parse(uri), doc)
  }

  useTextDocumentWatcher((document) => {
    if (document.uri.scheme === ClientUriScheme) {
      const uri = document.uri.toString()
      const file = files.get(uri)
      if (file)
        return file

      console.warn('Document updated before tracking:', uri)
      trackContent(uri)
    }
  })

  useDisposable(workspace.onDidOpenTextDocument(({ uri }) => {
    if (uri.scheme === ClientUriScheme)
      trackContent(uri.toString())
  }))
  useDisposable(workspace.onDidCloseTextDocument(({ uri }) => {
    if (uri.scheme === ClientUriScheme) {
      files.delete(uri.toString())
      rpc.untrackContent({ clientId: connection.selfId, uri: uri.toString() })
    }
  }))

  const [__, recvSave] = connection.makeAction<string>('textSave')
  const autoSave = computed(() => filesConfig.autoSave === 'afterDelay')
  recvSave(async (uri) => {
    if (autoSave.value)
      return
    const file = files.get(uri)
    if (file) {
      const document = await workspace.openTextDocument(Uri.parse(uri))
      await document.save()
    }
  })

  const willSaveDocuments = new Set<string>()
  useDisposable(workspace.onWillSaveTextDocument(({ document }) => {
    if (document.uri.scheme === ClientUriScheme) {
      willSaveDocuments.add(document.uri.toString())
    }
  }))

  const [_, recvFsChange] = connection.makeAction<FileChangeEvent>('fsChange')
  recvFsChange(({ uri, type }) => fileChanged([{ uri: Uri.parse(uri), type }]))

  useSetActiveProvider({
    watch(uri_, options) {
      const handle = rpc.fsWatch(connection.selfId, uri_.toString(), options)
      return {
        async dispose() {
          await rpc.fsUnwatch(await handle)
        },
      }
    },
    async stat(uri) {
      return handleFsError(await rpc.fsStat(uri.toString()))
    },
    async readDirectory(uri) {
      return handleFsError(await rpc.fsReadDirectory(uri.toString()))
    },
    async createDirectory(uri) {
      return handleFsError(await rpc.fsCreateDirectory(uri.toString()))
    },
    async readFile(uri) {
      return handleFsError(await rpc.fsReadFile(uri.toString()))
    },
    async writeFile(uri, content, options) {
      const file = files.get(uri.toString())
      if (file) {
        if (!willSaveDocuments.delete(uri.toString())) {
          // `workspace.fs.writeFile` by other extension
          forceUpdateContent(uri, file, content)
        }
        // Ensure saved to the disk
        await rpc.saveContent(uri.toString())
        return
      }
      return handleFsError(await rpc.fsWriteFile(uri.toString(), content, options))
    },
    async delete(uri, options) {
      return handleFsError(await rpc.fsDelete(uri.toString(), options))
    },
    async rename(oldUri, newUri, options) {
      return handleFsError(await rpc.fsRename(oldUri.toString(), newUri.toString(), options))
    },
  })
}
