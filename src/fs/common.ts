import type { Uri } from 'vscode'
import type { FilesMap } from './types'
import { useDisposable } from 'reactive-vscode'
import { Range, window, workspace } from 'vscode'
import * as Y from 'yjs'
import { logger } from '../utils'
import { isContentTracked } from './types'

const editingUris = new Map<string, number>()

export function useTextDocumentWatcher(
  doc: Y.Doc,
  files: FilesMap,
  toTrackedUri: (uri_: Uri) => string | undefined,
) {
  useDisposable(workspace.onDidChangeTextDocument((e) => {
    if (e.contentChanges.length === 0) {
      return
    }

    if (editingUris.has(e.document.uri.toString())) {
      return
    }

    const uri = toTrackedUri(e.document.uri)
    if (!uri) {
      return
    }
    const file = files.get(uri)
    if (file === undefined) {
      logger.error('Document missing in YJSFS:', uri)
      return
    }
    if (!isContentTracked(file)) {
      // This document is not tracked
      return
    }

    if (file.toString() === e.document.getText()) {
      console.warn('Out of sync edit')
      return
    }

    let textFile: Y.Text
    doc.transact(() => {
      if (file instanceof Uint8Array) {
        const content = new TextDecoder().decode(file)
        files.set(uri, textFile = new Y.Text(content))
      }
      else {
        textFile = file
      }
    })
    doc.transact(() => {
      const sortedChanges = e.contentChanges.slice().sort((a, b) => b.rangeOffset - a.rangeOffset)
      for (const change of sortedChanges) {
        textFile.delete(change.rangeOffset, change.rangeLength)
        textFile.insert(change.rangeOffset, change.text)
      }
    })
  }))
}

export const applyTextDocumentDelta = createSequentialFunction(async (uri: Uri, delta: Y.YEvent<any>['delta']) => {
  const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
  if (editor && editor.document.uri.toString() === uri.toString()) {
    const doc = editor.document
    try {
      editingUris.set(uri.toString(), editingUris.get(uri.toString()) ?? 0 + 1)
      await editor.edit((edits) => {
        let index = 0
        for (const d of delta) {
          if (d.retain) {
            index += d.retain
          }
          else if (d.insert) {
            const insert = d.insert as string
            edits.insert(doc.positionAt(index), insert)
          }
          else if (d.delete) {
            edits.delete(new Range(
              doc.positionAt(index),
              doc.positionAt(index + d.delete),
            ))
            index += d.delete
          }
        }
      })
    }
    finally {
      const count = (editingUris.get(uri.toString()) ?? 1) - 1
      if (count <= 0) {
        editingUris.delete(uri.toString())
      }
      else {
        editingUris.set(uri.toString(), count)
      }
    }
    return doc
  }
  else {
    return null
  }
})

function createSequentialFunction<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  let lastPromise: Promise<any> = Promise.resolve()
  return ((...args: any[]) => lastPromise = lastPromise.then(() => {
    return fn(...args)
  })) as T
}
