import type { BirpcReturn } from 'birpc'
import type { FileChangeEvent } from 'vscode'
import type { ClientFunctions, HostFunctions } from '../rpc/types'
import type { FileContent, FilesMap } from './types'
import { FileChangeType, FileSystemError, FileType, Uri, window, workspace } from 'vscode'
import * as Y from 'yjs'
import { logger, normalizeUint8Array } from '../utils'
import { applyTextDocumentDelta, useTextDocumentWatcher } from './common'
import { ClientUriScheme, useFsProvider } from './provider'
import { getName, getParent, isContentTracked, isDirectory, toFileType } from './types'

export function useClientFs(doc: Y.Doc, rpc: BirpcReturn<HostFunctions, ClientFunctions>) {
  const files = doc.getMap('fs') as FilesMap
  const { fileChanged, useSetActiveProvider } = useFsProvider()

  const watchMatchers = new Set<(uri: string) => boolean>()

  files.observeDeep((events) => {
    const affectedUris = new Map<string, FileChangeType>()
    for (const event of events) {
      if (event.transaction.local) {
        continue
      }

      if (event.target instanceof Y.Map) {
        for (const [uri, { action }] of event.keys) {
          affectedUris.set(uri, {
            add: FileChangeType.Created,
            update: FileChangeType.Changed,
            delete: FileChangeType.Deleted,
          }[action])

          if (action !== 'delete') {
            const newValue = event.target.get(uri) as FileContent
            if (newValue instanceof Y.Text) {
              applyTextDocumentDelta(Uri.parse(uri), [
                { delete: Infinity },
                { insert: newValue.toString() },
              ])
            }
          }
        }
      }

      else if (event.target instanceof Y.Text) {
        const { path, delta } = event
        const uri = path[0] as string
        affectedUris.set(uri, FileChangeType.Changed)
        applyTextDocumentDelta(Uri.parse(uri), delta)
      }
    }

    const result: FileChangeEvent[] = []
    for (const [uri, type] of affectedUris) {
      for (const matcher of watchMatchers) {
        if (matcher(uri)) {
          result.push({
            uri: Uri.parse(uri),
            type,
          })
          break
        }
      }
    }
    fileChanged(result)
  })

  useTextDocumentWatcher(doc, files, (uri) => {
    if (uri.scheme === ClientUriScheme) {
      return uri.toString()
    }
  })

  useSetActiveProvider({
    watch(uri_, { recursive, excludes }) {
      const uri = uri_.toString()

      function matcher(u: string) {
        if (!u.startsWith(uri)) {
          return false
        }
        if (!recursive) {
          const rest = u.slice(uri.length)
          if (!/^\/?[^/]*\/?$/.test(rest)) {
            return false
          }
        }
        return !excludes.some((pattern) => {
          const [part0, part1] = pattern.split('**')
          if (u.startsWith(part0) && (!part1 || u.endsWith(part1))) {
            return true
          }
          return false
        })
      }

      watchMatchers.add(matcher)
      return {
        dispose() {
          watchMatchers.delete(matcher)
        },
      }
    },
    async stat(uri) {
      const file = await trackedGet(uri)
      if (file === undefined) {
        throw FileSystemError.FileNotFound(uri)
      }
      return {
        type: toFileType(file),
        ctime: Date.now(),
        mtime: Date.now(),
        size: file instanceof Uint8Array ? file.byteLength : file instanceof Y.Text ? file.length : Number.NaN,
      }
    },
    async readDirectory(uri) {
      const file = await trackedGet(uri)
      if (isDirectory(file)) {
        const result = await rpc.trackDirectory(uri.toString())
        if (!result)
          throw new Error('Failed to read directory')
        return result
      }
      else if (file === undefined) {
        throw FileSystemError.FileNotFound(uri)
      }
      else {
        throw FileSystemError.FileNotADirectory(uri)
      }
    },
    async createDirectory(uri) {
      const file = await trackedGet(uri)
      if (file === undefined || file === FileType.Unknown) {
        files.set(uri.toString(), FileType.Directory)
      }
      else if (file !== FileType.Directory) {
        logger.error('Out of sync!')
      }
    },
    async readFile(uri) {
      const file = await trackedGet(uri)
      if (file === undefined) {
        throw FileSystemError.FileNotFound(uri)
      }
      if (isDirectory(file)) {
        throw FileSystemError.FileIsADirectory(uri)
      }
      if (!isContentTracked(file)) {
        const forceText = workspace.textDocuments.some(d => d.uri.toString() === uri.toString())
        const content = await rpc.trackFile(uri.toString(), forceText)
        if (!content) {
          throw FileSystemError.FileNotFound(uri)
        }
        return content
      }
      if (file instanceof Y.Text) {
        return (new TextEncoder()).encode(file.toString())
      }
      return file
    },
    async writeFile(uri, content, options) {
      const file = await trackedGet(uri)
      if (file === undefined) {
        if (!options.create) {
          throw FileSystemError.FileNotFound(uri)
        }
      }
      else if (!options.overwrite) {
        throw FileSystemError.FileExists(uri)
      }
      if (isDirectory(file)) {
        throw FileSystemError.FileIsADirectory(uri)
      }
      const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
      if (editor) {
        // TODO: Written by other extension?
      }
      else {
        files.set(uri.toString(), normalizeUint8Array(content))
      }
    },
    async delete(uri, options) {
      const file = await trackedGet(uri)
      if (file === undefined) {
        throw FileSystemError.FileNotFound(uri)
      }
      if (!options.recursive && isDirectory(file)) {
        return
      }
      files.delete(uri.toString())
    },
    async rename(oldUri, newUri, { overwrite }) {
      const error = await rpc.renameFile(oldUri.toString(), newUri.toString(), overwrite)
      if (error) {
        const ErrCtor = FileSystemError[error as keyof typeof FileSystemError] as any
        throw new ErrCtor()
      }
    },
  })

  async function trackedGet(uri: Uri): Promise<FileContent | undefined> {
    const parentUri = getParent(uri)
    const parent = files.get(parentUri)
    if (parent !== undefined) {
      // Already tracked
      return files.get(uri.toString())
    }
    else {
      // May not tracked
      const siblings = await rpc.trackDirectory(parentUri)
      if (!siblings)
        throw new Error('Failed to read parent directory')
      const name = getName(uri)
      return siblings.find(([n]) => n === name)?.[1]
    }
  }
}
