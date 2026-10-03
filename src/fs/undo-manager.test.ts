import type { DocUndoManager, UndoChange } from './undo-manager'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import * as Y from 'yjs'

import { createDocUndoManager, LocalOrigin } from './undo-manager'

function edit(undo: DocUndoManager, ...changes: UndoChange[]) {
  undo.captureChanges(changes)
  undo.doc.transact(() => {
    const text = undo.doc.getText()
    for (const change of changes.slice().sort((a, b) => b.rangeOffset - a.rangeOffset)) {
      text.delete(change.rangeOffset, change.rangeLength)
      text.insert(change.rangeOffset, change.text)
    }
  }, LocalOrigin)
}

describe('editor undo groups', () => {
  it('keeps adjacent typing together across ordinary typing pauses', async () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    edit(undo, { rangeOffset: 0, rangeLength: 0, text: 'a' })
    await new Promise(resolve => setTimeout(resolve, 300))
    edit(undo, { rangeOffset: 1, rangeLength: 0, text: 'b' })
    undo.undo()
    assert.equal(doc.getText().toString(), '')
    undo.redo()
    assert.equal(doc.getText().toString(), 'ab')
    doc.destroy()
  })

  it('starts a separate group for a word, paste, replacement and distant edit', () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    for (const character of 'one two')
      edit(undo, { rangeOffset: doc.getText().length, rangeLength: 0, text: character })
    undo.undo()
    assert.equal(doc.getText().toString(), 'one')
    undo.redo()
    edit(undo, { rangeOffset: 7, rangeLength: 0, text: 'PASTE' })
    edit(undo, { rangeOffset: 12, rangeLength: 0, text: 'x' })
    edit(undo, { rangeOffset: 0, rangeLength: 0, text: 'y' })
    undo.undo()
    assert.equal(doc.getText().toString(), 'one twoPASTEx')
    undo.undo()
    assert.equal(doc.getText().toString(), 'one twoPASTE')
    undo.undo()
    assert.equal(doc.getText().toString(), 'one two')
    edit(undo, { rangeOffset: 0, rangeLength: 3, text: 'ONE' })
    undo.undo()
    assert.equal(doc.getText().toString(), 'one two')
    doc.destroy()
  })

  it('separates incoming changes and explicit navigation from adjacent typing', () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    edit(undo, { rangeOffset: 0, rangeLength: 0, text: 'a' })
    doc.transact(() => doc.getText().insert(1, 'X'), { peerId: 'remote' })
    edit(undo, { rangeOffset: 1, rangeLength: 0, text: 'b' })
    undo.stopCapturing()
    edit(undo, { rangeOffset: 2, rangeLength: 0, text: 'c' })
    undo.undo()
    assert.equal(doc.getText().toString(), 'abX')
    undo.undo()
    assert.equal(doc.getText().toString(), 'aX')
    undo.undo()
    assert.equal(doc.getText().toString(), 'X')
    doc.destroy()
  })

  it('separates typing, backward deletion and forward deletion', () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    for (const character of 'abcde')
      edit(undo, { rangeOffset: doc.getText().length, rangeLength: 0, text: character })
    edit(undo, { rangeOffset: 3, rangeLength: 1, text: '' })
    edit(undo, { rangeOffset: 2, rangeLength: 1, text: '' })
    edit(undo, { rangeOffset: 2, rangeLength: 1, text: '' })
    undo.undo()
    assert.equal(doc.getText().toString(), 'abe')
    undo.undo()
    assert.equal(doc.getText().toString(), 'abcde')
    undo.undo()
    assert.equal(doc.getText().toString(), '')
    doc.destroy()
  })
})

describe('Y.UndoManager collaborative undo behavior', () => {
  it('restores directed selections and rebases them around remote edits', () => {
    const doc = new Y.Doc()
    doc.getText().insert(0, 'abcd')
    const undo = createDocUndoManager(doc)
    undo.captureSelection([{ anchor: 3, active: 1 }, { anchor: 4, active: 4 }])
    doc.transact(() => {
      doc.getText().delete(1, 2)
      doc.getText().insert(1, 'Z')
    }, LocalOrigin)
    doc.transact(() => doc.getText().insert(0, 'X'), { peerId: 'remote' })
    undo.captureSelection([{ anchor: 3, active: 3 }])
    undo.undo()
    assert.equal(doc.getText().toString(), 'Xabcd')
    assert.deepEqual(undo.restoreSelection(), [{ anchor: 4, active: 2 }, { anchor: 5, active: 5 }])
    undo.captureSelection(undo.restoreSelection()!)
    undo.redo()
    assert.equal(doc.getText().toString(), 'XaZd')
    assert.deepEqual(undo.restoreSelection(), [{ anchor: 3, active: 3 }])
    doc.destroy()
  })

  it('retains the selection before the first edit in a captured group', () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    undo.captureSelection([{ anchor: 0, active: 0 }])
    doc.transact(() => doc.getText().insert(0, 'a'), LocalOrigin)
    undo.captureSelection([{ anchor: 1, active: 1 }])
    doc.transact(() => doc.getText().insert(1, 'b'), LocalOrigin)
    undo.captureSelection([{ anchor: 2, active: 2 }])
    undo.undo()
    assert.equal(doc.getText().toString(), '')
    assert.deepEqual(undo.restoreSelection(), [{ anchor: 0, active: 0 }])
    undo.captureSelection(undo.restoreSelection()!)
    undo.redo()
    assert.deepEqual(undo.restoreSelection(), [{ anchor: 2, active: 2 }])
    doc.destroy()
  })

  it('keeps both peers in sync when each undoes and redoes their own interleaved edits', () => {
    const host = new Y.Doc()
    const guest = new Y.Doc()
    const hostUndo = createDocUndoManager(host)
    const guestUndo = createDocUndoManager(guest)
    const sync = (from: Y.Doc, to: Y.Doc) => Y.applyUpdateV2(to, Y.encodeStateAsUpdateV2(from), { peerId: from.clientID })
    const expectText = (text: string) => {
      assert.equal(host.getText().toString(), text)
      assert.equal(guest.getText().toString(), text)
    }

    host.transact(() => host.getText().insert(0, 'hello'), LocalOrigin)
    sync(host, guest)
    guest.transact(() => guest.getText().insert(3, 'X'), LocalOrigin)
    sync(guest, host)
    expectText('helXlo')

    hostUndo.undo()
    sync(host, guest)
    expectText('X')
    assert.equal(hostUndo.undo(), null, 'an empty local stack must leave the remote text intact')

    guestUndo.undo()
    sync(guest, host)
    expectText('')
    guestUndo.redo()
    sync(guest, host)
    expectText('X')
    hostUndo.redo()
    sync(host, guest)
    expectText('helXlo')

    host.destroy()
    guest.destroy()
  })

  it('preserves remote edits received between undo and redo', () => {
    const host = new Y.Doc()
    const guest = new Y.Doc()
    const undo = createDocUndoManager(host)
    host.transact(() => host.getText().insert(0, 'hello'), LocalOrigin)
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    guest.getText().insert(3, 'X')
    Y.applyUpdateV2(host, Y.encodeStateAsUpdateV2(guest), { peerId: 'guest' })
    undo.undo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    guest.getText().insert(1, 'Y')
    Y.applyUpdateV2(host, Y.encodeStateAsUpdateV2(guest), { peerId: 'guest' })
    assert.equal(host.getText().toString(), 'XY')

    undo.redo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    assert.equal(host.getText().toString(), guest.getText().toString())
    assert.equal(host.getText().toString().replace(/[XY]/g, ''), 'hello')
    undo.undo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    assert.equal(host.getText().toString(), 'XY')
    assert.equal(guest.getText().toString(), 'XY')

    host.destroy()
    guest.destroy()
  })

  it('restores a local deletion without deleting a remote insertion', () => {
    const doc = new Y.Doc()
    doc.getText().insert(0, 'abcd')
    const undo = createDocUndoManager(doc)
    doc.transact(() => doc.getText().delete(1, 2), LocalOrigin)
    doc.transact(() => doc.getText().insert(1, 'X'), { peerId: 'guest' })
    assert.equal(doc.getText().toString(), 'aXd')
    undo.undo()
    assert.equal(doc.getText().toString().replace('X', ''), 'abcd')
    undo.redo()
    assert.equal(doc.getText().toString(), 'aXd')
    doc.destroy()
  })

  it('does not track initial content and releases its observers when the document is destroyed', () => {
    const doc = new Y.Doc()
    const undo = createDocUndoManager(doc)
    doc.getText().insert(0, 'initial')
    assert.equal(undo.undo(), null)
    doc.destroy()
    doc.transact(() => doc.getText().insert(0, 'later'), LocalOrigin)
    assert.equal(undo.undoStack.length, 0)
  })

  it('tracks local changes, ignores remote changes', () => {
    const doc = new Y.Doc()
    const um = createDocUndoManager(doc)

    // 模拟本地编辑
    doc.transact(() => {
      doc.getText().insert(0, 'local')
    }, LocalOrigin)
    assert.equal(um.undoStack.length, 1, 'should track local change')

    // 模拟远程变更 (origin !== LocalOrigin)
    doc.transact(() => {
      doc.getText().insert(5, '-remote')
    }, { peerId: 'peer' })
    assert.equal(um.undoStack.length, 1, 'should NOT track remote change as new item')

    assert.equal(doc.getText().toString(), 'local-remote')

    // Undo: 只撤销本地变更
    um.undo()
    assert.equal(doc.getText().toString(), '-remote', `undo should leave only remote text, got "${doc.getText().toString()}"`)

    doc.destroy()
  })

  it('correctly undoes with concurrent interleaved edits', () => {
    const doc = new Y.Doc()
    const localUm = createDocUndoManager(doc)

    // 本地用户插入 "hello" — 5 个 CRDT items
    doc.transact(() => {
      doc.getText().insert(0, 'hello')
    }, LocalOrigin)

    assert.equal(doc.getText().toString(), 'hello')

    // 模拟远程 peer 在 "hel" 和 "lo" 之间插入 "X"
    // 用 applyUpdateV2 模拟远程更新 — origin 不是 LocalOrigin
    const remoteDoc = new Y.Doc()
    Y.applyUpdateV2(remoteDoc, Y.encodeStateAsUpdateV2(doc))
    remoteDoc.getText().insert(3, 'X')
    const remoteUpdate = Y.encodeStateAsUpdateV2(remoteDoc)

    // 应用远程更新
    Y.applyUpdateV2(doc, remoteUpdate, { peerId: 'remote' })
    assert.equal(doc.getText().toString(), 'helXlo', `concurrent edit should produce "helXlo", got "${doc.getText().toString()}"`)

    // 本地 undo — UndoManager 知道 "hello" 对应的 CRDT items
    localUm.undo()
    assert.equal(doc.getText().toString(), 'X', `undo should leave only "X", got "${doc.getText().toString()}"`)

    doc.destroy()
    remoteDoc.destroy()
  })

  it('undo then redo restores original text', () => {
    const doc = new Y.Doc()
    const um = createDocUndoManager(doc)

    doc.transact(() => {
      doc.getText().insert(0, 'test')
    }, LocalOrigin)

    assert.equal(doc.getText().toString(), 'test')

    um.undo()
    assert.equal(doc.getText().toString(), '')

    um.redo()
    assert.equal(doc.getText().toString(), 'test')

    assert.equal(um.undoStack.length, 1)
    assert.equal(um.redoStack.length, 0)

    doc.destroy()
  })

  it('only undoes local transactions, not remote ones mixed in between', () => {
    const doc = new Y.Doc()
    const um = createDocUndoManager(doc)

    // 本地插入 "A"
    doc.transact(() => doc.getText().insert(0, 'A'), LocalOrigin)
    // 远程插入 "B" 在 "A" 之后
    doc.transact(() => doc.getText().insert(1, 'B'), { peerId: 'peer' })
    // 本地插入 "C" 在 "B" 之后
    doc.transact(() => doc.getText().insert(2, 'C'), LocalOrigin)

    assert.equal(doc.getText().toString(), 'ABC')
    assert.equal(um.undoStack.length, 2, 'remote changes separate the two local undo groups')

    // 撤销所有本地事务
    while (um.undoStack.length > 0)
      um.undo()

    assert.equal(doc.getText().toString(), 'B', `after undoing all local changes, only remote "B" should remain, got "${doc.getText().toString()}"`)

    // Redo 恢复本地变更
    while (um.redoStack.length > 0)
      um.redo()

    assert.equal(doc.getText().toString(), 'ABC', `after redo all should be "ABC", got "${doc.getText().toString()}"`)

    doc.destroy()
  })
})
