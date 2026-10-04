import type { FileChangeType, TextDocument, TextDocumentChangeReason, TextEditor, Uri } from 'vscode'
import type * as Y from 'yjs'
import type { DocUndoManager, UndoSelection } from './undo-manager'
import { useCommand, useDisposable } from 'reactive-vscode'
import { commands, FileSystemError, Range, Selection, window, workspace, WorkspaceEdit } from 'vscode'

export type FilesMap = Y.Map<Y.Doc>
export interface TrackContentRequest { guestId: string, uri: string, content?: string }
export interface FileChangeEvent { uri: string, type: FileChangeType }

const editingUris = new Map<string, number>()
const editorSelections = new WeakMap<TextDocument, UndoSelection[]>()
const selectionVersions = new WeakMap<TextEditor, number>()

function rememberSelection(editor: TextEditor) {
  const selections = editor.selections.map(selection => ({
    anchor: editor.document.offsetAt(selection.anchor),
    active: editor.document.offsetAt(selection.active),
  }))
  editorSelections.set(editor.document, selections)
  selectionVersions.set(editor, editor.document.version)
  return selections
}

export function useUndoRedo(getUndoManager: (document: TextDocument) => DocUndoManager | undefined) {
  for (const editor of window.visibleTextEditors)
    rememberSelection(editor)
  useDisposable(window.onDidChangeTextEditorSelection(({ textEditor }) => {
    // Typing also moves the cursor, but changes the document version first.
    // A selection change at the same version is a separate navigation action.
    if (selectionVersions.get(textEditor) === textEditor.document.version)
      getUndoManager(textEditor.document)?.stopCapturing()
    rememberSelection(textEditor)
  }))
  let previousEditor = window.activeTextEditor
  useDisposable(window.onDidChangeActiveTextEditor((editor) => {
    if (previousEditor)
      getUndoManager(previousEditor.document)?.stopCapturing()
    if (editor) {
      getUndoManager(editor.document)?.stopCapturing()
      rememberSelection(editor)
    }
    previousEditor = editor
  }))
  const runUndoRedo = createSequentialFunction(async (editor: TextEditor, undoManager: DocUndoManager, command: 'undo' | 'redo') => {
    await applyTextDocumentDelta.wait()
    if (window.activeTextEditor !== editor || getUndoManager(editor.document) !== undoManager)
      return
    undoManager.captureSelection(rememberSelection(editor))
    const item = undoManager[command]()
    // An empty local stack must not fall back to VS Code's stack, which
    // also contains remote edits. Wait for the resulting editor changes.
    await applyTextDocumentDelta.wait()
    if (item && window.activeTextEditor === editor && getUndoManager(editor.document) === undoManager) {
      const selections = undoManager.restoreSelection()
      if (selections?.length) {
        editor.selections = selections.map(({ anchor, active }) => new Selection(
          editor.document.positionAt(anchor),
          editor.document.positionAt(active),
        ))
      }
    }
  })
  // Override commands, so custom keybindings and the Edit menu work too.
  // These registrations are disposed with the host/guest session scope.
  for (const command of ['undo', 'redo'] as const) {
    useCommand(command, async (...args: unknown[]) => {
      const editor = window.activeTextEditor
      const undoManager = editor && getUndoManager(editor.document)
      if (!editor || !undoManager)
        return commands.executeCommand(`default:${command}`, ...args)

      return runUndoRedo(editor, undoManager, command)
    })
  }
}

export function useTextDocumentWatcher(getUndoManager: (document: TextDocument) => DocUndoManager | undefined) {
  useDisposable(workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
    if (contentChanges.length === 0 || editingUris.has(document.uri.toString())) {
      return
    }

    getUndoManager(document)?.applyChanges(contentChanges, editorSelections.get(document))
  }))
}

export function setupTextDocumentUpdater(
  uri_: Uri,
  doc: Y.Doc,
  um?: Y.UndoManager,
) {
  doc.getText().observe((event) => {
    // Skip local changes UNLESS they came from UndoManager (needs to sync to editor)
    if (event.transaction.local && event.transaction.origin !== um)
      return
    applyTextDocumentDelta(uri_, event.delta, event.transaction.origin?.reason)
  })
}

const applyTextDocumentDelta = createSequentialFunction(async (uri: Uri, delta: Y.YEvent<any>['delta'], _reason: TextDocumentChangeReason | undefined) => {
  try {
    editingUris.set(uri.toString(), (editingUris.get(uri.toString()) ?? 0) + 1)

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
        undoStopBefore: true,
        undoStopAfter: true,
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

function createSequentialFunction<T extends (...args: any[]) => Promise<any>>(fn: T) {
  let lastPromise: Promise<any> = Promise.resolve()
  return Object.assign(
    ((...args) => lastPromise = lastPromise.then(() => fn(...args))) as T,
    { wait: () => lastPromise },
  )
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
