import type { IDisposable } from 'node-pty'
import type { Connection } from '../sync/connection'
import type { FileChangeEvent, TrackContentRequest } from './common'
import picomatch from 'picomatch'
import { useDisposable } from 'reactive-vscode'
import { Disposable, FileChangeType, RelativePattern, Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { forceUpdateContent, fsErrorWrapper, setupTextDocumentUpdater, useTextDocumentWatcher } from './common'

export function useHostFs(connection: Connection) {
  const { toHostUri, toTrackUri } = connection

  const files = new Map<string, {
    doc: Y.Doc
    trackers: Set<string>
  }>()

  const [send, recv] = connection.makeAction<Uint8Array, string>('texts')
  recv((update, peerId, uri) => {
    const file = files.get(uri!)
    if (file)
      Y.applyUpdateV2(file.doc, update, { peerId })
  })

  async function trackContent({ clientId, uri, content }: TrackContentRequest) {
    const file = files.get(uri)
    if (file) {
      file.trackers.add(clientId)
      if (content !== undefined)
        file.doc.getText().insert(0, content)
      return Y.encodeStateAsUpdateV2(file.doc)
    }
    else {
      const doc = new Y.Doc()
      const trackers = new Set<string>([clientId])
      files.set(uri, { doc, trackers })

      doc.on('updateV2', async (update: Uint8Array, origin: any) => {
        if (origin?.peerId)
          return
        await send(update, [...trackers], uri)
      })

      const uri_ = toHostUri(Uri.parse(uri))
      setupTextDocumentUpdater(uri_, doc)

      const newText = content ?? new TextDecoder().decode(await workspace.fs.readFile(uri_))
      doc.getText().insert(0, newText)

      return Y.encodeStateAsUpdateV2(doc)
    }
  }
  function untrackContent({ clientId, uri }: TrackContentRequest) {
    const file = files.get(uri)
    if (file) {
      file.trackers.delete(clientId)
      if (file.trackers.size === 0) {
        files.delete(uri)
        file.doc.destroy()
      }
    }
  }
  async function saveContent(uri: string) {
    const file = files.get(uri)
    if (file) {
      const uri_ = toHostUri(Uri.parse(uri))
      const document = await workspace.openTextDocument(uri_)
      await document.save()
    }
  }

  useTextDocumentWatcher((document) => {
    const uri = toTrackUri(document.uri)
    if (!uri)
      return
    return files.get(uri.toString())?.doc
  })

  const [sendSave, _] = connection.makeAction<string>('textSave')
  useDisposable(workspace.onDidSaveTextDocument((document) => {
    const uri = toTrackUri(document.uri)
    if (!uri)
      return
    const file = files.get(uri.toString())
    if (file)
      sendSave(uri.toString(), [...file.trackers])
  }))

  let currentWatchHandle = 0
  const watchers = new Map<number, IDisposable>()
  const [sendFsChange] = connection.makeAction<FileChangeEvent>('fsChange')

  async function fsWatch(clientId: string, uri: string, options: {
    readonly recursive: boolean
    readonly excludes: readonly string[]
  }) {
    const uri_ = toHostUri(Uri.parse(uri))
    const pattern = options.recursive ? '**/*' : '*'
    const relativePattern = new RelativePattern(uri_, pattern)

    const watcher = workspace.createFileSystemWatcher(relativePattern)
    const isExcluded = picomatch(options.excludes as string[])

    const forwardEvent = async (type: FileChangeType, uri_: Uri) => {
      const uri = toTrackUri(uri_)
      if (!uri || isExcluded(uri.toString()))
        return
      if (type === FileChangeType.Changed) {
        const file = files.get(uri.toString())
        if (file?.trackers.has(clientId)) {
          if (!workspace.textDocuments.some(doc => doc.uri.toString() === uri_.toString())) {
            // If the text document os open, `workspace.onDidChangeTextDocument` will handle the update, otherwise we need to force update here
            const newContent = await workspace.fs.readFile(uri_)
            forceUpdateContent(uri_, file.doc, newContent)
          }
          return
        }
      }
      sendFsChange({ uri: uri.toString(), type }, clientId)
    }

    const handle = currentWatchHandle++
    watchers.set(handle, Disposable.from(
      watcher,
      watcher.onDidCreate(uri_ => forwardEvent(FileChangeType.Created, uri_)),
      watcher.onDidChange(uri_ => forwardEvent(FileChangeType.Changed, uri_)),
      watcher.onDidDelete(uri_ => forwardEvent(FileChangeType.Deleted, uri_)),
    ))
    return handle
  }

  async function fsUnwatch(handle: number) {
    const watcher = watchers.get(handle)
    if (watcher) {
      watcher.dispose()
      watchers.delete(handle)
    }
  }

  async function fsStat(uri: string) {
    const uri_ = toHostUri(Uri.parse(uri))
    return await workspace.fs.stat(uri_)
  }

  async function fsReadDirectory(uri: string) {
    const uri_ = toHostUri(Uri.parse(uri))
    return await workspace.fs.readDirectory(uri_)
  }

  async function fsCreateDirectory(uri: string) {
    const uri_ = toHostUri(Uri.parse(uri))
    await workspace.fs.createDirectory(uri_)
  }

  async function fsReadFile(uri: string) {
    const file = files.get(uri)
    if (file) {
      return new TextEncoder().encode(file.doc.getText().toString())
    }

    const uri_ = toHostUri(Uri.parse(uri))
    return await workspace.fs.readFile(uri_)
  }

  async function fsWriteFile(uri: string, content: Uint8Array, _options: {
    readonly create: boolean
    readonly overwrite: boolean
  }) {
    const file = files.get(uri)
    if (file) {
      // Rare. Only happens when the file is being edited by client who doesn't open the file in the editor
      forceUpdateContent(uri, file.doc, content)
      return
    }

    const uri_ = toHostUri(Uri.parse(uri))
    await workspace.fs.writeFile(uri_, content)
  }

  async function fsDelete(uri: string, options: { readonly recursive: boolean }) {
    const uri_ = toHostUri(Uri.parse(uri))
    await workspace.fs.delete(uri_, options)
  }

  async function fsRename(oldUri: string, newUri: string, options: { readonly overwrite: boolean }) {
    const oldUri_ = toHostUri(Uri.parse(oldUri))
    const newUri_ = toHostUri(Uri.parse(newUri))
    await workspace.fs.rename(oldUri_, newUri_, options)
  }

  return {
    trackContent,
    untrackContent,
    saveContent,
    fsWatch,
    fsUnwatch,
    fsStat: fsErrorWrapper(fsStat),
    fsReadDirectory: fsErrorWrapper(fsReadDirectory),
    fsCreateDirectory: fsErrorWrapper(fsCreateDirectory),
    fsReadFile: fsErrorWrapper(fsReadFile),
    fsWriteFile: fsErrorWrapper(fsWriteFile),
    fsDelete: fsErrorWrapper(fsDelete),
    fsRename: fsErrorWrapper(fsRename),
  }
}
