import type { BirpcReturn } from 'birpc'
import type { TextDocumentChangeReason } from 'vscode'
import type { GuestFunctions, HostFunctions } from '../rpc/types'
import type { Connection } from '../sync/connection'
import type { FileChangeEvent } from './common'
import { computed, defineConfig, useDisposable } from 'reactive-vscode'
import { FileType, Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { forceUpdateContent, handleFsError, setupTextDocumentUpdater, useTextDocumentWatcher } from './common'
import { CustomUriScheme, useFsProvider } from './provider'

const filesConfig = defineConfig<any>('files')

export function useGuestFs(connection: Connection, rpc: BirpcReturn<HostFunctions, GuestFunctions>, hostId: string) {
  const { fileChanged, useSetActiveProvider } = useFsProvider()

  const files = new Map<string, {
    doc: Y.Doc
    mtime: number
    ctime?: number
  }>()
  const [send, recv] = connection.makeAction<Uint8Array, [string, TextDocumentChangeReason?]>('texts')

  recv((update, peerId, meta) => {
    const [uri, reason] = meta!
    const file = files.get(uri)
    if (file)
      Y.applyUpdateV2(file.doc, update, { reason, peerId })
  })

  async function trackContent(uri: string) {
    const doc = new Y.Doc()
    const init = await rpc.trackContent({ guestId: connection.selfId, uri })
    Y.applyUpdateV2(doc, init)
    files.set(uri, {
      doc,
      mtime: Date.now(),
    })

    doc.on('updateV2', async (update: Uint8Array, origin: any) => {
      if (origin?.peerId)
        return
      await send(update, hostId, [uri, origin?.reason])
    })
    setupTextDocumentUpdater(Uri.parse(uri), doc)
  }

  useTextDocumentWatcher((document) => {
    if (document.uri.scheme === CustomUriScheme) {
      const uri = document.uri.toString()
      const file = files.get(uri)
      if (file)
        return file.doc

      console.warn('Document updated before tracking:', uri)
      trackContent(uri)
    }
  })

  useDisposable(workspace.onDidOpenTextDocument(({ uri }) => {
    if (uri.scheme === CustomUriScheme)
      trackContent(uri.toString())
  }))
  useDisposable(workspace.onDidCloseTextDocument(({ uri }) => {
    if (uri.scheme === CustomUriScheme) {
      files.delete(uri.toString())
      rpc.untrackContent({ guestId: connection.selfId, uri: uri.toString() })
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
    if (document.uri.scheme === CustomUriScheme) {
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
      const file = files.get(uri.toString())
      if (file) {
        return {
          type: FileType.File,
          ctime: file.ctime ??= handleFsError(await rpc.fsStat(uri.toString())).ctime,
          mtime: file.mtime,
          size: file.doc.getText().length,
        }
      }
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
          forceUpdateContent(uri, file.doc, content)
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
