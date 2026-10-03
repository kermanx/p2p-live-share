import * as Y from 'yjs'

export const LocalOrigin = Symbol('local')

export interface UndoSelection { anchor: number, active: number }

const selectionKey = Symbol('selection')
const managers = new WeakMap<Y.Doc, DocUndoManager>()

export class DocUndoManager extends Y.UndoManager {
  private selection?: { anchor: Y.RelativePosition, active: Y.RelativePosition }[]

  constructor(doc: Y.Doc) {
    super(doc.getText(), {
      trackedOrigins: new Set([LocalOrigin]),
      captureTimeout: 200,
    })
    this.on('stack-item-added', ({ stackItem }) => {
      // Keep the selection before the first edit in a group. During undo/redo,
      // the new opposite-stack item captures the current selection instead.
      stackItem.meta.set(selectionKey, this.selection)
    })
    this.on('stack-item-popped', ({ stackItem }) => {
      this.selection = stackItem.meta.get(selectionKey)
    })
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
