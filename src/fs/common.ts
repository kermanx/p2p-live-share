import type { FileChangeType, TextDocument, Uri } from 'vscode'
import type * as Y from 'yjs'
import { useDisposable } from 'reactive-vscode'
import { FileSystemError, Range, window, workspace, WorkspaceEdit } from 'vscode'

export type FilesMap = Y.Map<Y.Doc>
export interface TrackContentRequest { guestId: string, uri: string, content?: string }
export interface FileChangeEvent { uri: string, type: FileChangeType }

const editingUris = new Map<string, number>()

export function useTextDocumentWatcher(getDoc: (document: TextDocument) => Y.Doc | null | undefined) {
  useDisposable(workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
    if (contentChanges.length === 0 || editingUris.has(document.uri.toString())) {
      return
    }

    const doc = getDoc(document)
    if (!doc) {
      return
    }

    doc.transact(() => {
      const text = doc.getText()
      const sortedChanges = contentChanges.slice().sort((a, b) => b.rangeOffset - a.rangeOffset)
      for (const change of sortedChanges) {
        text.delete(change.rangeOffset, change.rangeLength)
        text.insert(change.rangeOffset, change.text)
      }
    })
  }))
}

export function setupTextDocumentUpdater(uri_: Uri, doc: Y.Doc) {
  doc.getText().observe((event) => {
    if (event.transaction.local)
      return
    applyTextDocumentDelta(uri_, event.delta)
  })
}

const applyTextDocumentDelta = createSequentialFunction(async (uri: Uri, delta: Y.YEvent<any>['delta']) => {
  try {
    editingUris.set(uri.toString(), (editingUris.get(uri.toString()) ?? 0) + 1)

    // Try updating via editor
    const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
    if (editor && editor.document.uri.toString() === uri.toString()) {
      const doc = editor.document
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
      }, {
        undoStopBefore: false,
        undoStopAfter: false,
      })
      return
    }

    // Update with document
    // Should NOT use `workspace.fs.writeFile`, as the document may be unsaved
    const doc = await workspace.openTextDocument(uri)
    const edits = new WorkspaceEdit()
    let index = 0
    for (const d of delta) {
      if (d.retain) {
        index += d.retain
      }
      else if (d.insert) {
        const insert = d.insert as string
        edits.insert(uri, doc.positionAt(index), insert)
      }
      else if (d.delete) {
        edits.delete(uri, new Range(
          doc.positionAt(index),
          doc.positionAt(index + d.delete),
        ))
        index += d.delete
      }
    }
    await workspace.applyEdit(edits)
  }
  finally {
    const count = (editingUris.get(uri.toString()) ?? 1) - 1
    if (count <= 0)
      editingUris.delete(uri.toString())
    else
      editingUris.set(uri.toString(), count)
  }
})

function createSequentialFunction<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  let lastPromise: Promise<any> = Promise.resolve()
  return ((...args) => lastPromise = lastPromise.then(() => fn(...args))) as T
}

export function forceUpdateContent(uri: Uri | string, doc: Y.Doc, content: Uint8Array) {
  const newText = new TextDecoder().decode(content)
  const oldText = doc.getText().toString()
  if (oldText !== newText) {
    doc.transact(() => {
      const text = doc.getText()
      text.delete(0, text.length)
      text.insert(0, newText)
    })
    console.warn('External edit to', uri.toString())
  }
}

interface FsResult<T> { ok?: T, err?: string }

export function fsErrorWrapper<A extends any[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<FsResult<R>> {
  return async (...args) => {
    try {
      return { ok: await fn(...args) }
    }
    catch (e) {
      if (e instanceof FileSystemError)
        return { err: e.code }
      throw e
    }
  }
}

export function handleFsError<T>(result: FsResult<T>): T {
  if (result.err) {
    const factory = FileSystemError[result.err as keyof typeof FileSystemError] as any
    if (typeof factory !== 'function')
      throw new Error(`Unknown FileSystemError code: ${result.err}`)
    throw factory()
  }
  return result.ok!
}
