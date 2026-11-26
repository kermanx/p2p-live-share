import type { TextBuffer } from './text-sync'
import type { UndoChange } from './undo-manager'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { applyDelta, changesToDelta, deltaToChanges, diffToDelta, transform } from './delta'
import { TextDocumentSync } from './text-sync'
import { DocUndoManager } from './undo-manager'

function tick(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function makeRandom(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    return seed / 0x80000000
  }
}

// Works like a VS Code document. Our edits arrive later and are rejected if the version
// changed. The extension host only sees changes trough events, in order
class FakeBuffer implements TextBuffer {
  // What the user sees
  text: string
  private mainVersion = 1
  // What the extension host sees
  private hostText: string
  version = 1
  private readonly events: { version: number, changes: UndoChange[] }[] = []
  listener?: (version: number, changes: UndoChange[]) => void
  latency = () => 1
  resultFirst = () => false
  // Next edits fail even if the version matches
  failNext = 0
  gate?: Promise<void>
  applying = false

  constructor(text: string) {
    this.text = this.hostText = text
  }

  getText() {
    return this.hostText
  }

  private emit(changes: UndoChange[]) {
    this.text = applyDelta(this.text, changesToDelta(changes))
    this.events.push({ version: ++this.mainVersion, changes })
    return this.mainVersion
  }

  private deliver(until = Infinity) {
    while (this.events.length && this.events[0].version <= until) {
      const { version, changes } = this.events.shift()!
      this.hostText = applyDelta(this.hostText, changesToDelta(changes))
      this.version = version
      this.listener?.(version, changes)
    }
  }

  // Change by the user
  type(changes: UndoChange[]) {
    this.emit(changes)
    setTimeout(() => this.deliver(), this.latency())
  }

  async applyChanges(changes: UndoChange[], version: number) {
    this.applying = true
    await (this.gate ?? tick(this.latency()))
    this.applying = false
    if (this.mainVersion !== version || this.failNext-- > 0)
      return false
    const newVersion = this.emit(changes)
    if (this.resultFirst())
      setTimeout(() => this.deliver(), this.latency())
    else
      this.deliver(newVersion)
    return newVersion
  }

  // Change without any event, like a lost edit
  corrupt(text: string) {
    this.text = this.hostText = text
  }

  async settle() {
    while (this.events.length)
      await tick(1)
  }
}

function createPeer(text: string) {
  const doc = new Y.Doc()
  doc.getText().insert(0, text)
  const buffer = new FakeBuffer(text)
  const undoManager = new DocUndoManager(doc)
  const divergences: string[] = []
  const sync = new TextDocumentSync(doc.getText(), undoManager, async () => buffer, {
    echoTimeout: 500,
    onDivergence: bufferText => divergences.push(bufferText),
  })
  buffer.listener = (version, changes) => sync.handleBufferChange({ version, changes })
  return { doc, buffer, undoManager, sync, divergences }
}

function connect(a: Y.Doc, b: Y.Doc, latency: () => number) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  let inFlight = 0
  for (const [from, to] of [[a, b], [b, a]]) {
    from.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote')
        return
      inFlight++
      setTimeout(() => {
        inFlight--
        Y.applyUpdate(to, update, 'remote')
      }, latency())
    })
  }
  return { idle: () => inFlight === 0 }
}

describe('delta helpers', () => {
  it('converts between changes and deltas', () => {
    const changes = [
      { rangeOffset: 6, rangeLength: 5, text: 'there' },
      { rangeOffset: 0, rangeLength: 0, text: '> ' },
    ]
    const delta = changesToDelta(changes)
    assert.equal(applyDelta('hello world', delta), '> hello there')
    assert.deepEqual(deltaToChanges(delta), changes.slice().reverse())
  })

  it('converges when transforming concurrent edits', () => {
    const random = makeRandom(1)
    const randomDelta = (text: string) => {
      const offset = Math.floor(random() * (text.length + 1))
      const length = Math.floor(random() * (text.length - offset + 1) * 0.5)
      return changesToDelta([{ rangeOffset: offset, rangeLength: length, text: random() < 0.7 ? 'xyz'.slice(0, 1 + Math.floor(random() * 3)) : '' }])
    }
    for (let i = 0; i < 500; i++) {
      const base = 'abcdefghij'.slice(0, Math.floor(random() * 11))
      const a = randomDelta(base)
      const b = randomDelta(base)
      assert.equal(
        applyDelta(applyDelta(base, a), transform(a, b, true)),
        applyDelta(applyDelta(base, b), transform(b, a, false)),
      )
    }
  })

  it('diffs without splitting surrogate pairs', () => {
    assert.deepEqual(diffToDelta('a😀b', 'a😁b'), [{ retain: 1 }, { insert: '😁' }, { delete: 2 }])
    assert.equal(applyDelta('abc', diffToDelta('abc', 'abXc')), 'abXc')
  })
})

describe('text document sync', () => {
  it('keeps a local edit made while a remote edit is in flight', async () => {
    const peer = createPeer('hello world')
    let release!: () => void
    peer.buffer.gate = new Promise(resolve => release = resolve)
    peer.buffer.latency = () => 0
    // A remote edit arrives...
    Y.applyUpdate(peer.doc, (() => {
      const remote = new Y.Doc()
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(peer.doc))
      remote.getText().insert(0, '> ')
      return Y.encodeStateAsUpdate(remote, Y.encodeStateVector(peer.doc))
    })(), 'remote')
    while (!peer.buffer.applying)
      await tick()
    // ...and the user types before it reached the buffer
    peer.buffer.type([{ rangeOffset: 11, rangeLength: 0, text: '!' }])
    await peer.buffer.settle()
    peer.buffer.gate = undefined
    release()
    await peer.buffer.settle()
    await peer.sync.flush()
    assert.equal(peer.doc.getText().toString(), '> hello world!')
    assert.equal(peer.buffer.text, '> hello world!')
    assert.deepEqual(peer.divergences, [])
  })

  it('retries an edit rejected by the editor', async () => {
    const peer = createPeer('abc')
    peer.buffer.failNext = 2
    peer.doc.transact(() => peer.doc.getText().insert(3, 'd'), peer.undoManager)
    await peer.sync.flush()
    assert.equal(peer.buffer.text, 'abcd')
  })

  it('reconciles a buffer that diverged', async () => {
    const peer = createPeer('abc')
    peer.buffer.corrupt('abXc')
    peer.doc.transact(() => peer.doc.getText().insert(0, '1'), peer.undoManager)
    await peer.sync.flush()
    assert.equal(peer.buffer.text, '1abc')
    assert.equal(peer.divergences.length, 1)
  })

  it('applies undo of a local edit to the buffer', async () => {
    const peer = createPeer('abc')
    peer.buffer.type([{ rangeOffset: 3, rangeLength: 0, text: 'd' }])
    await peer.buffer.settle()
    peer.undoManager.undo()
    await peer.sync.flush()
    assert.equal(peer.buffer.text, 'abc')
  })

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`converges with concurrent edits on two peers (seed ${seed})`, async () => {
      const random = makeRandom(seed)
      const a = createPeer('The quick brown fox\njumps over\nthe lazy dog\n')
      const b = createPeer('')
      const network = connect(a.doc, b.doc, () => Math.floor(random() * 4))
      await b.sync.flush()
      for (const peer of [a, b]) {
        peer.buffer.latency = () => Math.floor(random() * 3)
        peer.buffer.resultFirst = () => random() < 0.3
      }

      for (let step = 0; step < 300; step++) {
        const peer = random() < 0.5 ? a : b
        const text = peer.buffer.text
        const randomChange = (min: number) => {
          const offset = min + Math.floor(random() * (text.length - min + 1))
          const length = random() < 0.4 ? Math.floor(random() * Math.min(4, text.length - offset + 1)) : 0
          const insert = random() < 0.8 ? 'xy\nz'.slice(0, 1 + Math.floor(random() * 4)) : ''
          return { rangeOffset: offset, rangeLength: length, text: insert }
        }
        const first = randomChange(0)
        // Sometimes multi cursor
        const second = random() < 0.2 && first.rangeOffset + first.rangeLength < text.length
          ? randomChange(first.rangeOffset + first.rangeLength + 1)
          : undefined
        peer.buffer.type(second ? [second, first] : [first])
        if (random() < 0.1)
          peer.undoManager.undo()
        if (random() < 0.5)
          await tick(Math.floor(random() * 3))
      }

      for (let i = 0; i < 50 && !(network.idle() && a.buffer.text === b.buffer.text); i++) {
        await tick(5)
        await Promise.all([a.buffer.settle(), b.buffer.settle()])
        await Promise.all([a.sync.flush(), b.sync.flush()])
      }
      const text = a.doc.getText().toString()
      assert.equal(b.doc.getText().toString(), text)
      assert.equal(a.buffer.text, text)
      assert.equal(b.buffer.text, text)
      // Should never need the fallback
      assert.deepEqual(a.divergences, [])
      assert.deepEqual(b.divergences, [])
      a.sync.dispose()
      b.sync.dispose()
    })
  }
})
