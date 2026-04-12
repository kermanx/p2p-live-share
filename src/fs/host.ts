import type { TextDocument } from 'vscode'
import type { Connection } from '../sync/connection'
import type { FileContent, FilesMap } from './types'
import { computed, useFileSystemWatcher } from 'reactive-vscode'
import { FileSystemError, FileType, Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { useObserverDeep, useObserverShallow } from '../sync/doc'
import { logger } from '../utils'
import { applyTextDocumentDelta, useTextDocumentWatcher } from './common'
import { isSameContent, readContent, watchSubDocChanges, writeContent } from './subdoc'
import { getParent, isContentTracked, isDir, toFileType } from './types'

export function useHostFs(connection: Connection, doc: Y.Doc) {
  const { toHostUri, toTrackUri } = connection
  const files = doc.getMap('fs') as FilesMap
  const trackedDirs = new Set<string>()
  const isTracked = (uri: Uri | null): uri is Uri => !!uri && trackedDirs.has(getParent(uri))

  const filesConfig = workspace.getConfiguration('files')
  const autoSave = computed(() => filesConfig.get('autoSave') === 'afterDelay' && filesConfig.get('autoSaveDelay', 1000) <= 1100)
  const unsavedDocs = new Map<string, TextDocument>()

  function loadSubDoc(uri_: Uri, subDoc: Y.Doc) {
    subDoc.load()
    watchSubDocChanges(
      subDoc,
      async (delta) => {
        const writtenToDoc = await applyTextDocumentDelta(uri_, delta)
        if (writtenToDoc) {
          if (!autoSave.value) {
            unsavedDocs.set(uri_.toString(), writtenToDoc)
          }
        }
        else {
          workspace.fs.writeFile(uri_, readContent(subDoc))
        }
      },
      () => workspace.fs.writeFile(uri_, readContent(subDoc)),
    )
  }

  useObserverDeep(() => files, (event) => {
    if (event.transaction.local) {
      return
    }

    // Files changed
    for (const [uri, { action, oldValue }] of event.keys) {
      const uri_ = toHostUri(Uri.parse(uri))
      console.log('File changed:', uri, uri_.toString(), action, oldValue)
      if (action !== 'add') {
        workspace.fs.delete(uri_, { recursive: true, useTrash: false })
        if (isContentTracked(oldValue))
          oldValue.destroy()
      }
      if (action !== 'delete') {
        const newValue = event.target.get(uri) as FileContent
        if (newValue === FileType.Directory) {
          workspace.fs.createDirectory(uri_)
        }
        else if (newValue === FileType.File) {
          workspace.fs.writeFile(uri_, new Uint8Array())
        }
        else if (isContentTracked(newValue)) {
          logger.error('Unexpected tracked content added in files map:', uri)
        }
        else {
          throw new TypeError(`Not implemented: ${newValue}`)
        }
      }
    }
  })

  useFileSystemWatcher('**', {
    onDidDelete(uri_) {
      const uri = toTrackUri(uri_)
      if (!isTracked(uri))
        return
      doc.transact(() => {
        files.delete(uri.toString())
      })
    },
    async onDidCreate(uri_) {
      const uri = toTrackUri(uri_)
      if (!isTracked(uri))
        return
      const stat = await workspace.fs.stat(uri_)
      doc.transact(() => {
        const existing = files.get(uri.toString())
        if (isDir(existing) !== isDir(stat.type))
          logger.error('Directory replaced by file', uri_.toString())
        if (!existing)
          files.set(uri.toString(), stat.type)
      })
    },
    async onDidChange(uri_) {
      const uri = toTrackUri(uri_)
      if (!isTracked(uri))
        return
      const stat = await workspace.fs.stat(uri_)
      const content = stat.type & FileType.File ? await workspace.fs.readFile(uri_) : null
      doc.transact(() => {
        const existing = files.get(uri.toString())
        if (!existing || toFileType(existing) !== stat.type) {
          files.set(uri.toString(), stat.type)
        }
        else if (isContentTracked(existing)) {
          if (!isSameContent(existing, content!)) {
            console.warn('External edit', uri_.toString())
            writeContent(existing, content!)
          }
        }
      })
    },
  })

  async function init() {
    // Initialize the root directory
    for (const root of workspace.workspaceFolders || []) {
      const uri = toTrackUri(root.uri)!.toString()
      files.set(uri, FileType.Directory)
      await trackDirectory(uri)
    }
  }
  init()

  useTextDocumentWatcher(
    doc,
    files,
    (uri_, _, text) => {
      const uri = toTrackUri(uri_)
      const file = uri && files.get(uri.toString())
      if (isContentTracked(file)) {
        writeContent(file, text, true)
      }
    },
    (uri_) => {
      const uri = toTrackUri(uri_)
      if (isTracked(uri)) {
        return uri.toString()
      }
    },
  )

  async function trackDirectory(uriStr: string) {
    const uri = Uri.parse(uriStr)
    // if (!isTracked(uri)) {
    //   logger.error('Directory not tracked:', uri)
    //   return
    // }
    const uri_ = toHostUri(uri)

    const { type } = await workspace.fs.stat(uri_)
    if (!isDir(type)) {
      logger.error('Not a directory:', uri)
      return
    }
    trackedDirs.add(uriStr)
    const children = await workspace.fs.readDirectory(uri_)

    doc.transact(() => {
      for (const [name, type] of children) {
        const childUri = Uri.joinPath(uri, name)
        files.set(childUri.toString(), type)
      }
    })

    return children
  }

  async function trackContent(uriStr: string, forceText: boolean, overwrite?: Uint8Array | string): Promise<Uint8Array | null> {
    const uri = Uri.parse(uriStr)
    if (!isTracked(uri)) {
      logger.error('Parent directory not tracked:', uri)
    }

    const uri_ = toHostUri(uri)
    // // This wrap of `new Uint8Array()` is necessary to convert Uint8Array subclasses (e.g. Buffer) to Uint8Array, which is required for Y.Doc encoding
    // const content = new Uint8Array(await workspace.fs.readFile(uri_))
    const content = overwrite ?? await workspace.fs.readFile(uri_)
    if (overwrite != null)
      await workspace.fs.writeFile(uri_, typeof overwrite === 'string' ? new TextEncoder().encode(overwrite) : overwrite)

    doc.transact(() => {
      const existing = files.get(uriStr)
      if (isContentTracked(existing)) {
        writeContent(existing, content, forceText)
      }
      else {
        const doc = files.set(uriStr, new Y.Doc())
        loadSubDoc(uri_, doc)
        writeContent(doc, content, forceText)
      }
    })

    return overwrite == null ? content as Uint8Array : null
  }

  async function renameFile(oldUri: string, newUri: string, overwrite: boolean) {
    try {
      const oldUri_ = toHostUri(Uri.parse(oldUri))
      const newUri_ = toHostUri(Uri.parse(newUri))
      await workspace.fs.rename(oldUri_, newUri_, { overwrite })
    }
    catch (e: any) {
      if (e instanceof FileSystemError) {
        return e.code
      }
      else {
        throw e
      }
    }
  }

  async function saveFile(uri: string) {
    const uri_ = toHostUri(Uri.parse(uri))
    const doc = unsavedDocs.get(uri_.toString())
    if (doc) {
      await doc.save()
      unsavedDocs.delete(uri_.toString())
    }
  }

  async function subDocInit(uri: string) {
    const subDoc = files.get(uri) as Y.Doc
    if (!subDoc) {
      logger.error('Sub-document not found for URI:', uri)
      return
    }
    return Y.encodeStateAsUpdateV2(subDoc)
  }

  return {
    trackDirectory,
    trackContent,
    renameFile,
    saveFile,
    subDocInit,
  }
}
