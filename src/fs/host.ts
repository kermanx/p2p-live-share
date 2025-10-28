import type { TextDocument } from 'vscode'
import type { Connection } from '../sync/connection'
import type { FileContent, FilesMap } from './types'
import { useFsWatcher } from 'reactive-vscode'
import { FileSystemError, FileType, Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { logger } from '../utils'
import { applyTextDocumentDelta, useTextDocumentWatcher } from './common'
import { getParent, isContentTracked, isDirectory } from './types'

export function useHostFs(connection: Connection, doc: Y.Doc) {
  const { toHostUri, toTrackUri } = connection
  const files = doc.getMap('fs') as FilesMap
  const trackedDirs = new Set<string>()

  const filesConfig = workspace.getConfiguration('files')
  const unsavedDocs = new Map<string, TextDocument>()

  files.observeDeep((events) => {
    for (const event of events) {
      if (event.transaction.local) {
        continue
      }

      if (event.target instanceof Y.Map) {
        // Files changed
        for (const [uri, { action }] of event.keys) {
          const uri_ = toHostUri(Uri.parse(uri))
          if (action === 'delete') {
            workspace.fs.delete(uri_, { recursive: true, useTrash: false })
          }
          else if (action === 'add') {
            const newValue = event.target.get(uri) as FileContent
            if (newValue === FileType.Directory) {
              workspace.fs.createDirectory(uri_)
            }
            else if (newValue === FileType.File) {
              workspace.fs.writeFile(uri_, new Uint8Array())
            }
            else if (newValue instanceof Uint8Array) {
              workspace.fs.writeFile(uri_, newValue)
            }
            else if (newValue instanceof Y.Text) {
              workspace.fs.writeFile(uri_, new TextEncoder().encode(newValue.toString()))
            }
            else {
              // TODO
              throw new TypeError(`Not implemented: ${newValue}`)
            }
          }
          else if (action === 'update') {
            const _newValue = event.target.get(uri) as FileContent
            // TODO
          }
          else {
            throw new Error(`Invalid action: ${action}`)
          }

          // TODO: handle changed Y.Text
        }
      }

      else if (event.target instanceof Y.Text) {
        const { path, delta } = event
        const uri_ = toHostUri(Uri.parse(path[0] as string))
        applyTextDocumentDelta(uri_, delta).then((writtenToDoc) => {
          if (writtenToDoc) {
            const autoSave = filesConfig.get('autoSave') === 'afterDelay' && filesConfig.get('autoSaveDelay', 1000) <= 1100
            if (!autoSave) {
              unsavedDocs.set(uri_.toString(), writtenToDoc)
            }
          }
          else {
            workspace.fs.writeFile(uri_, new TextEncoder().encode(event.target.toString()))
          }
        })
      }
    }
  })

  const fsWatcher = useFsWatcher('**')
  fsWatcher.onDidDelete(async (uri) => {
    const trackedUri = toTrackUri(uri)
    if (trackedUri) {
      files.delete(trackedUri.toString())
    }
  })
  fsWatcher.onDidCreate(async (uri) => {
    const trackedUri = toTrackUri(uri)
    const stat = await workspace.fs.stat(uri)
    doc.transact(() => {
      if (trackedUri && !files.has(trackedUri.toString())) {
        files.set(trackedUri.toString(), stat.type)
      }
    })
  })
  fsWatcher.onDidChange(async (uri) => {
    const trackedUri = toTrackUri(uri)
    if (!trackedUri) {
      return
    }
    const stat = await workspace.fs.stat(uri)
    const content = stat.type & FileType.File ? await workspace.fs.readFile(uri) : null
    doc.transact(() => {
      const existing = files.get(trackedUri.toString())
      if (!existing || !isContentTracked(existing)) {
        files.set(trackedUri.toString(), stat.type)
      }
      else if (existing instanceof Uint8Array) {
        files.set(trackedUri.toString(), new Uint8Array(content!))
      }
      else if (existing instanceof Y.Text) {
        const text = new TextDecoder().decode(content!)
        if (existing.toString() !== text) {
          console.warn('External edit', uri.toString())
          existing.delete(0, existing.length)
          existing.insert(0, text)
        }
      }
    })
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

  useTextDocumentWatcher(doc, files, (uri) => {
    const clientUri = toTrackUri(uri)
    if (clientUri && trackedDirs.has(getParent(clientUri))) {
      return clientUri.toString()
    }
  })

  async function trackDirectory(uri: string) {
    const uri_ = toHostUri(Uri.parse(uri))
    trackedDirs.add(uri)
    let file = files.get(uri)
    if (file === undefined) {
      const { type } = await workspace.fs.stat(uri_)
      files.set(uri, type)
      file = type
    }
    if (!isDirectory(file)) {
      logger.error('Directory requested but not a directory in YJSFS:', uri)
      return
    }
    const children = await workspace.fs.readDirectory(uri_)
    for (const [name, type] of children) {
      const childUri = Uri.joinPath(Uri.parse(uri), name).toString()
      if (type & FileType.File) {
        const file = files.get(childUri)
        if (file === undefined || typeof file === 'number') {
          files.set(childUri, FileType.File)
        }
      }
      else {
        files.set(childUri, type)
      }
    }
    return children
  }

  async function trackFile(uri: string, forceText: boolean) {
    const file = files.get(uri)
    if (file === undefined) {
      return undefined
    }
    if (!isContentTracked(file)) {
      const uri_ = toHostUri(Uri.parse(uri))
      const content = new Uint8Array(await workspace.fs.readFile(uri_))
      if (forceText) {
        const text = new TextDecoder().decode(content)
        files.set(uri, new Y.Text(text))
      }
      else {
        files.set(uri, content)
      }
      return content
    }
    if (file instanceof Y.Text) {
      return (new TextEncoder()).encode(file.toString())
    }
    return file
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

  return {
    trackDirectory,
    trackFile,
    renameFile,
    saveFile,
  }
}
