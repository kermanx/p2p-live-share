import * as Y from 'yjs'

export const LocalOrigin = Symbol('local')

export interface UndoSelection { anchor: number, active: number }
export interface UndoChange { rangeOffset: number, rangeLength: number, text: string }

interface EditGroup {
  change: UndoChange
  kind: 'insert' | 'delete'
  spaces: number
  direction?: 'backward' | 'forward'
}

const selectionKey = Symbol('selection')
const managers = new WeakMap<Y.Doc, DocUndoManager>()

export class DocUndoManager extends Y.UndoManager {
  private selection?: { anchor: Y.RelativePosition, active: Y.RelativePosition }[]
  private previousChange?: EditGroup
  private readonly onTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin !== LocalOrigin && transaction.origin !== this && transaction.changed.has(this.doc.getText() as Y.AbstractType<any>))
      this.stopCapturing()
  }

  constructor(doc: Y.Doc) {
    super(doc.getText(), {
      trackedOrigins: new Set([LocalOrigin]),
      captureTimeout: 1000,
    })
    doc.on('afterTransaction', this.onTransaction)
    this.on('stack-item-added', ({ stackItem }) => {
      // Keep the selection before the first edit in a group. During undo/redo,
      // the new opposite-stack item captures the current selection instead.
      stackItem.meta.set(selectionKey, this.selection)
    })
    this.on('stack-item-popped', ({ stackItem }) => {
      this.selection = stackItem.meta.get(selectionKey)
    })
  }

  // VS Code does not expose its undo boundaries. Merge only adjacent character
  // input/deletion here; replacements, paste and multi-edit operations stand
  // alone. Selection movement and incoming edits also end the current group.
  captureChanges(changes: readonly UndoChange[]) {
    const change = changes.length === 1 ? changes[0] : undefined
    const kind = change && change.rangeLength === 0 && change.text.length <= 2 && Array.from(change.text).length === 1 && !/[\r\n\t]/.test(change.text)
      ? 'insert'
      : change && change.text === '' && change.rangeLength === 1 ? 'delete' : undefined
    const previous = this.previousChange
    let continuous = false
    let direction: EditGroup['direction']
    let spaces = 0
    if (change && previous && kind === previous.kind) {
      if (kind === 'insert') {
        continuous = change.rangeOffset === previous.change.rangeOffset + previous.change.text.length
        spaces = change.text === ' ' ? previous.spaces + 1 : 0
        // Match the common native typing behavior: start a group at the first
        // space, then include the following word; repeated spaces end a group.
        if ((spaces === 1 && previous.spaces === 0) || (spaces === 0 && previous.spaces > 1))
          continuous = false
      }
      else {
        direction = change.rangeOffset === previous.change.rangeOffset
          ? 'forward'
          : change.rangeOffset + change.rangeLength === previous.change.rangeOffset ? 'backward' : undefined
        continuous = direction !== undefined && (!previous.direction || direction === previous.direction)
      }
    }
    else if (change?.text === ' ') {
      spaces = 1
    }
    if (!continuous)
      this.stopCapturing()
    this.previousChange = change && kind ? { change, kind, spaces, direction } : undefined
  }

  override stopCapturing() {
    super.stopCapturing()
    this.previousChange = undefined
  }

  override destroy() {
    this.doc.off('afterTransaction', this.onTransaction)
    super.destroy()
  }

  captureSelection(selections: readonly UndoSelection[]) {
    const text = this.doc.getText()
    this.selection = selections.map(({ anchor, active }) => ({
      anchor: Y.createRelativePositionFromTypeIndex(text, anchor),
      active: Y.createRelativePositionFromTypeIndex(text, active),
    }))
  }

  restoreSelection(): UndoSelection[] | undefined {
    const selections = this.selection?.map(({ anchor, active }) => ({
      anchor: Y.createAbsolutePositionFromRelativePosition(anchor, this.doc)?.index,
      active: Y.createAbsolutePositionFromRelativePosition(active, this.doc)?.index,
    }))
    if (selections?.every(s => s.anchor !== undefined && s.active !== undefined))
      return selections as UndoSelection[]
  }
}

export function getDocUndoManager(doc: Y.Doc) {
  return managers.get(doc)
}

export function createDocUndoManager(doc: Y.Doc): DocUndoManager {
  const manager = new DocUndoManager(doc)
  managers.set(doc, manager)
  return manager
}
