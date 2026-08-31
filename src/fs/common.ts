import type { FileChangeType, TextDocument, TextDocumentChangeReason, Uri } from 'vscode'
import type * as Y from 'yjs'
import { useDisposable } from 'reactive-vscode'
import { FileSystemError, Range, window, workspace, WorkspaceEdit } from 'vscode'

export type FilesMap = Y.Map<Y.Doc>
export interface TrackContentRequest { guestId: string, uri: string, content?: string }
export interface FileChangeEvent { uri: string, type: FileChangeType }

const editingUris = new Map<string, number>()

export function useTextDocumentWatcher(getDoc: (document: TextDocument) => Y.Doc | null | undefined) {
  useDisposable(workspace.onDidChangeTextDocument(({ document, contentChanges, reason }) => {
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
    }, { reason })
  }))
}

export function setupTextDocumentUpdater(uri_: Uri, doc: Y.Doc) {
  doc.getText().observe((event) => {
    if (event.transaction.local)
      return
    applyTextDocumentDelta(uri_, event.delta, event.transaction.origin?.reason)
  })
}

const applyTextDocumentDelta = createSequentialFunction(async (uri: Uri, delta: Y.YEvent<any>['delta'], _reason: TextDocumentChangeReason | undefined) => {
  try {
    editingUris.set(uri.toString(), (editingUris.get(uri.toString()) ?? 0) + 1)

    // if (reason === TextDocumentChangeReason.Undo) {
    //   window.showInformationMessage('UNDO')
    //   await commands.executeCommand('default:undo')
    //   return
    // }
    // else if (reason === TextDocumentChangeReason.Redo) {
    //   window.showInformationMessage('REDO')
    //   await commands.executeCommand('default:redo')
    //   return
    // }

    // Try updating via editor
    const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
    if (editor) {
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

/**
 * 解码文件内容，自动处理 GB2312/GBK 编码。
 * 先用 UTF-8 严格解码，失败时 fallback 到 GBK。
 */
export function decodeTextFileContent(content: Uint8Array): string {
  try {
    // 先尝试 UTF-8 严格解码 — 纯 ASCII 和 UTF-8 都能通过
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  }
  catch {
    // UTF-8 解码失败（包含非法字节序列），尝试 GBK/GB2312
    try {
      return new TextDecoder('gbk').decode(content)
    }
    catch {
      // GBK 也不可用时，回退到宽松 UTF-8（可能乱码，但不会崩溃）
      return new TextDecoder('utf-8', { fatal: false }).decode(content)
    }
  }
}

export function forceUpdateContent(uri: Uri | string, doc: Y.Doc, content: Uint8Array) {
  const newText = decodeTextFileContent(content)
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
