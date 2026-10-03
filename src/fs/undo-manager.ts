import * as Y from 'yjs'

export const LocalOrigin = Symbol('local')

export function createDocUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(doc.getText(), {
    trackedOrigins: new Set([LocalOrigin]),
    captureTimeout: 200,
  })
}
