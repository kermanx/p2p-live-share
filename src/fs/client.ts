import type { BirpcReturn } from 'birpc'
import type { ClientFunctions, HostFunctions } from '../rpc/types'
import type { FileContent, FilesMap } from './types'
import { shallowReactive } from 'reactive-vscode'
import { FileChangeType, FileSystemError, FileType, Uri, window, workspace } from 'vscode'
import { watchEffect } from 'vue'
import * as Y from 'yjs'
import { useObserverDeep } from '../sync/doc'
import { logger } from '../utils'
import { applyTextDocumentDelta, useTextDocumentWatcher } from './common'
import { ClientUriScheme, useFsProvider } from './provider'
import { readContent, watchSubDocChanges, writeContent } from './subdoc'
import { getName, getParent, isContentTracked, isDir, toFileType } from './types'

export function useClientFs(doc: Y.Doc, rpc: BirpcReturn<HostFunctions, ClientFunctions>) {
  const files = doc.getMap('fs') as FilesMap
  const { fileChanged, useSetActiveProvider } = useFsProvider()

  const watchMatchers = shallowReactive(new Set<(uri: string) => boolean>())
  const isFileWatched = (uri: string) => [...watchMatchers].some(matcher => matcher(uri))
  const subDocs = shallowReactive(new Map<string, Y.Doc>())

  function loadSubDoc(uriStr: string, subDoc: Y.Doc) {
    rpc.subDocInit(uriStr).then((initData) => {
      if (!initData) {
        logger.error('Failed to initialize sub-document for URI:', uriStr)
        return
      }
      subDoc.load()
      Y.applyUpdateV2(subDoc, initData)
      const uri = Uri.parse(uriStr)
      watchSubDocChanges(
        subDoc,
        delta => applyTextDocumentDelta(uri, delta),
        () => fileChanged([{ uri, type: FileChangeType.Changed }]),
      )
    })
  }

  watchEffect(() => {
    for (const [uriStr, subDoc] of subDocs) {
      const shouldWatch = isFileWatched(uriStr)
      const isWatched = subDoc.isLoaded
      if (shouldWatch && !isWatched) {
        // FIXME: avoid re-loading if already loaded once
        loadSubDoc(uriStr, subDoc)
      }
      else if (!shouldWatch && isWatched) {
        subDoc.destroy()
      }
    }
  })

  useObserverDeep(() => files, (event) => {
    if (event.transaction.local) {
      return
    }

    if (event.target instanceof Y.Map) {
      for (const [uri, { action, oldValue }] of event.keys) {
        if (action !== 'add' && isContentTracked(oldValue)) {
          subDocs.delete(uri)
          // FIXME: destroy sub-doc
        }
        if (action !== 'update') {
          const newValue = event.target.get(uri) as FileContent
          if (isContentTracked(newValue)) {
            subDocs.set(uri, newValue)
          }
        }

        if (isFileWatched(uri)) {
          fileChanged([{
            uri: Uri.parse(uri),
            type: {
              add: FileChangeType.Created,
              update: FileChangeType.Changed,
              delete: FileChangeType.Deleted,
            }[action],
          }])
        }
      }
    }
  })

  useTextDocumentWatcher(
    doc,
    files,
    (uri, file, text) => {
      if (isContentTracked(file))
        loadSubDoc(uri.toString(), file)
      else
        rpc.trackContent(uri.toString(), true, text)
    },
    (uri) => {
      if (uri.scheme === ClientUriScheme) {
        return uri.toString()
      }
    },
  )

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
      if (isDir(file)) {
        return {
          type: FileType.Directory,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 0,
        }
      }
      const content = isContentTracked(file)
        ? readContent(file)
        : await rpc.trackContent(uri.toString(), false)
      if (!file || !content) {
        throw FileSystemError.FileNotFound(uri)
      }
      return {
        type: toFileType(file),
        ctime: Date.now(),
        mtime: Date.now(),
        size: content.byteLength,
      }
    },
    async readDirectory(uri) {
      const file = await trackedGet(uri)
      if (isDir(file)) {
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
      if (isDir(file)) {
        throw FileSystemError.FileIsADirectory(uri)
      }
      if (isContentTracked(file) && file.isLoaded) {
        return readContent(file)
      }
      const forceText = workspace.textDocuments.some(d => d.uri.toString() === uri.toString())
      const content = await rpc.trackContent(uri.toString(), forceText)
      if (!content) {
        throw FileSystemError.FileNotFound(uri)
      }
      return content
    },
    async writeFile(uri, content, options) {
      const file = await trackedGet(uri)
      if (isDir(file)) {
        throw FileSystemError.FileIsADirectory(uri)
      }

      if (file === undefined) {
        if (!options.create) {
          throw FileSystemError.FileNotFound(uri)
        }
      }
      else if (!options.overwrite) {
        throw FileSystemError.FileExists(uri)
      }

      if (isContentTracked(file)) {
        if (window.visibleTextEditors.some(e => e.document.uri.toString() === uri.toString())) {
          rpc.saveFile(uri.toString())
          // TODO: Written by other extension?
          return
        }

        writeContent(file, content)
      }
      else {
        rpc.trackContent(uri.toString(), false, content)
      }
    },
    async delete(uri) {
      const file = await trackedGet(uri)
      if (file === undefined) {
        throw FileSystemError.FileNotFound(uri)
      }
      if (isContentTracked(file)) {
        file.destroy()
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
    const file = files.get(uri.toString())
    if (file !== undefined) {
      // Already tracked
      return file
    }
    else {
      // May not tracked
      const parentUri = getParent(uri)
      const siblings = await rpc.trackDirectory(parentUri)
      if (!siblings)
        throw new Error('Failed to read parent directory')
      const name = getName(uri)
      return siblings.find(([n]) => n === name)?.[1]
    }
  }
}
