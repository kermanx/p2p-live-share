import type { FileChangeType, TextDocument, TextEditor, Uri } from 'vscode'
import type * as Y from 'yjs'
import type { TextBuffer } from './text-sync'
import type { DocUndoManager, UndoSelection } from './undo-manager'
import { useCommand, useDisposable } from 'reactive-vscode'
import { commands, FileSystemError, Range, Selection, TextEdit, window, workspace, WorkspaceEdit } from 'vscode'
import { TextDocumentSync } from './text-sync'

export type FilesMap = Y.Map<Y.Doc>
export interface TrackContentRequest { guestId: string, uri: string, content?: string }
export interface FileChangeEvent { uri: string, type: FileChangeType }

const syncs = new Map<string, TextDocumentSync>()
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
    await waitForTextDocumentSync()
    if (window.activeTextEditor !== editor || getUndoManager(editor.document) !== undoManager)
      return
    undoManager.captureSelection(rememberSelection(editor))
    const item = undoManager[command]()
    // An empty local stack must not fall back to VS Code's stack, which
    // also contains remote edits. Wait for the resulting editor changes.
    await waitForTextDocumentSync()
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
    if (contentChanges.length === 0)
      return
    // Also starts tracking on guest side
    if (!getUndoManager(document))
      return
    syncs.get(document.uri.toString())?.handleBufferChange({
      version: document.version,
      changes: contentChanges,
      selections: editorSelections.get(document),
    })
  }))
}

export function setupTextDocumentUpdater(uri: Uri, doc: Y.Doc, undoManager: DocUndoManager) {
  const key = uri.toString()
  const sync = new TextDocumentSync(doc.getText(), undoManager, () => openTextBuffer(uri))
  syncs.get(key)?.dispose()
  syncs.set(key, sync)
  doc.on('destroy', () => {
    sync.dispose()
    if (syncs.get(key) === sync)
      syncs.delete(key)
  })
}

function waitForTextDocumentSync() {
  return Promise.all(Array.from(syncs.values(), sync => sync.flush()))
}

async function openTextBuffer(uri: Uri): Promise<TextBuffer> {
  const key = uri.toString()
  const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === key)
  const document = editor?.document ?? await workspace.openTextDocument(uri)
  return {
    get version() {
      return document.version
    },
    getText: () => document.getText(),
    async applyChanges(changes, version) {
      if (document.isClosed || document.version !== version)
        return false
      const edits = changes
        .map(({ rangeOffset, rangeLength, text }) => TextEdit.replace(new Range(
          document.positionAt(rangeOffset),
          document.positionAt(rangeOffset + rangeLength),
        ), text))
        // Skip replacements that dont change anything
        .filter(edit => document.getText(edit.range) !== edit.newText)
      if (edits.length === 0)
        return version
      let applied = false
      if (editor && !editor.document.isClosed) {
        applied = await editor.edit((builder) => {
          for (const edit of edits)
            builder.replace(edit.range, edit.newText)
        }, { undoStopBefore: true, undoStopAfter: true })
      }
      // Changes always arrive before the edit result, so same version means it failed for a other
      // reason (e.g. no code editor attached). `applyEdit` also checks the version
      if (!applied && document.version === version) {
        // Preserve unsaved content when the document is not visible.
        const workspaceEdit = new WorkspaceEdit()
        workspaceEdit.set(uri, edits)
        applied = await workspace.applyEdit(workspaceEdit)
      }
      return applied ? version + 1 : false
    },
  }
}

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
