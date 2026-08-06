import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import * as Y from 'yjs'

/**
 * 独立测试 Y.UndoManager 在协同编辑场景下的行为。
 * 不能直接 import common.ts（依赖 vscode 模块），
 * 所以这里用和 common.ts 相同的逻辑独立构造测试。
 */
const LocalOrigin = Symbol('local')

function createUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(doc.getText(), {
    trackedOrigins: new Set([LocalOrigin]),
    captureTimeout: 200,
  })
}

describe('Y.UndoManager collaborative undo behavior', () => {
  it('tracks local changes, ignores remote changes', () => {
    const doc = new Y.Doc()
    const um = createUndoManager(doc)

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
    assert.equal(doc.getText().toString(), '-remote',
      `undo should leave only remote text, got "${doc.getText().toString()}"`)

    doc.destroy()
  })

  it('correctly undoes with concurrent interleaved edits', () => {
    const doc = new Y.Doc()
    const localUm = createUndoManager(doc)

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
    assert.equal(doc.getText().toString(), 'helXlo',
      `concurrent edit should produce "helXlo", got "${doc.getText().toString()}"`)

    // 本地 undo — UndoManager 知道 "hello" 对应的 CRDT items
    localUm.undo()
    assert.equal(doc.getText().toString(), 'X',
      `undo should leave only "X", got "${doc.getText().toString()}"`)

    doc.destroy()
    remoteDoc.destroy()
  })

  it('undo then redo restores original text', () => {
    const doc = new Y.Doc()
    const um = createUndoManager(doc)

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
    const um = createUndoManager(doc)

    // 本地插入 "A"
    doc.transact(() => doc.getText().insert(0, 'A'), LocalOrigin)
    // 远程插入 "B" 在 "A" 之后
    doc.transact(() => doc.getText().insert(1, 'B'), { peerId: 'peer' })
    // 本地插入 "C" 在 "B" 之后
    doc.transact(() => doc.getText().insert(2, 'C'), LocalOrigin)

    assert.equal(doc.getText().toString(), 'ABC')
    // captureTimeout=200ms 可能把两个本地事务合并为一个 undo step
    // 重要的是：撤销后只删除本地插入的字符，不删远程的 "B"
    assert.ok(um.undoStack.length >= 1, 'should have at least 1 local undo item')

    // 撤销所有本地事务
    while (um.undoStack.length > 0)
      um.undo()

    assert.equal(doc.getText().toString(), 'B',
      `after undoing all local changes, only remote "B" should remain, got "${doc.getText().toString()}"`)

    // Redo 恢复本地变更
    while (um.redoStack.length > 0)
      um.redo()

    assert.equal(doc.getText().toString(), 'ABC',
      `after redo all should be "ABC", got "${doc.getText().toString()}"`)

    doc.destroy()
  })
})
