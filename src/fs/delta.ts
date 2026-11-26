import type { UndoChange } from './undo-manager'

// Plain text deltas, same format as Yjs. Offsets are UTF-16 units like in VS Code and Y.Text
export type DeltaOp = { insert: string } | { retain: number } | { delete: number }
export type Delta = DeltaOp[]

type OpType = 'insert' | 'retain' | 'delete'

function opType(op: DeltaOp): OpType {
  return 'insert' in op ? 'insert' : 'delete' in op ? 'delete' : 'retain'
}

function opLength(op: DeltaOp) {
  return 'insert' in op ? op.insert.length : 'delete' in op ? op.delete : op.retain
}

class OpIterator {
  private index = 0
  private offset = 0

  constructor(private readonly ops: Delta) {}

  hasNext() {
    return this.peekLength() < Infinity
  }

  peekLength() {
    const op = this.ops[this.index]
    return op ? opLength(op) - this.offset : Infinity
  }

  // Past the end it behaves like a infinite retain
  peekType(): OpType {
    const op = this.ops[this.index]
    return op ? opType(op) : 'retain'
  }

  next(length = Infinity): DeltaOp {
    const op = this.ops[this.index]
    if (!op)
      return { retain: Infinity }
    const offset = this.offset
    const remaining = opLength(op) - offset
    const n = Math.min(length, remaining)
    if (n === remaining) {
      this.index++
      this.offset = 0
    }
    else {
      this.offset += n
    }
    if ('insert' in op)
      return { insert: op.insert.slice(offset, offset + n) }
    return 'delete' in op ? { delete: n } : { retain: n }
  }
}

class DeltaBuilder {
  readonly ops: Delta = []

  push(op: DeltaOp) {
    if (opLength(op) === 0)
      return
    const last = this.ops.at(-1)
    if (last && opType(last) === opType(op)) {
      if ('insert' in last)
        last.insert += (op as { insert: string }).insert
      else if ('delete' in last)
        last.delete += (op as { delete: number }).delete
      else
        last.retain += (op as { retain: number }).retain
      return
    }
    this.ops.push({ ...op })
  }

  chop() {
    const last = this.ops.at(-1)
    if (last && 'retain' in last)
      this.ops.pop()
    return this.ops
  }
}

// Y.Text event delta -> Delta, only plain text is supported
export function fromYDelta(delta: readonly { insert?: unknown, retain?: number, delete?: number }[]): Delta {
  const builder = new DeltaBuilder()
  for (const op of delta) {
    if (typeof op.insert === 'string')
      builder.push({ insert: op.insert })
    else if (op.delete)
      builder.push({ delete: op.delete })
    else if (op.retain)
      builder.push({ retain: op.retain })
  }
  return builder.chop()
}

// Transform `b` so it can be applied after `a` (both made on the same document).
// If both insert at same offset, `aFirst` decides wich one goes first
export function transform(a: Delta, b: Delta, aFirst: boolean): Delta {
  const aIter = new OpIterator(a)
  const bIter = new OpIterator(b)
  const out = new DeltaBuilder()
  while (aIter.hasNext() || bIter.hasNext()) {
    if (aIter.peekType() === 'insert' && (aFirst || bIter.peekType() !== 'insert')) {
      out.push({ retain: opLength(aIter.next()) })
    }
    else if (bIter.peekType() === 'insert') {
      out.push(bIter.next())
    }
    else {
      const n = Math.min(aIter.peekLength(), bIter.peekLength())
      const aOp = aIter.next(n)
      const bOp = bIter.next(n)
      // Already deleted by `a`, so drop it from `b`
      if ('delete' in aOp)
        continue
      out.push('delete' in bOp ? { delete: n } : { retain: n })
    }
  }
  return out.chop()
}

// Map a offset through `delta`, insert at the offset moves it to the right
export function transformPosition(delta: Delta, index: number) {
  const iter = new OpIterator(delta)
  let offset = 0
  while (iter.hasNext() && offset <= index) {
    const length = iter.peekLength()
    const type = iter.peekType()
    iter.next()
    if (type === 'delete') {
      index -= Math.min(length, index - offset)
      continue
    }
    if (type === 'insert')
      index += length
    offset += length
  }
  return index
}

// Changes must not overlap and are all relative to the same document
export function changesToDelta(changes: readonly UndoChange[]): Delta {
  const builder = new DeltaBuilder()
  let cursor = 0
  for (const change of changes.slice().sort((a, b) => a.rangeOffset - b.rangeOffset)) {
    builder.push({ retain: change.rangeOffset - cursor })
    builder.push({ insert: change.text })
    builder.push({ delete: change.rangeLength })
    cursor = change.rangeOffset + change.rangeLength
  }
  return builder.chop()
}

// Offsets are relative to the document before the delta, same as `contentChanges`
export function deltaToChanges(delta: Delta): UndoChange[] {
  const changes: UndoChange[] = []
  let cursor = 0
  let current: UndoChange | undefined
  for (const op of delta) {
    if ('retain' in op) {
      current = undefined
      cursor += op.retain
      continue
    }
    if (!current)
      changes.push(current = { rangeOffset: cursor, rangeLength: 0, text: '' })
    if ('insert' in op) {
      current.text += op.insert
    }
    else {
      current.rangeLength += op.delete
      cursor += op.delete
    }
  }
  return changes
}

export function applyDelta(text: string, delta: Delta) {
  let result = ''
  let cursor = 0
  for (const op of delta) {
    if ('insert' in op) {
      result += op.insert
    }
    else if ('delete' in op) {
      cursor += op.delete
    }
    else {
      result += text.slice(cursor, cursor + op.retain)
      cursor += op.retain
    }
  }
  return result + text.slice(cursor)
}

function isHighSurrogate(code: number) {
  return code >= 0xD800 && code <= 0xDBFF
}

function isLowSurrogate(code: number) {
  return code >= 0xDC00 && code <= 0xDFFF
}

// Only trims the common prefix and suffix, good enough for small differences
export function diffToDelta(from: string, to: string): Delta {
  const max = Math.min(from.length, to.length)
  let prefix = 0
  while (prefix < max && from.charCodeAt(prefix) === to.charCodeAt(prefix))
    prefix++
  if (prefix > 0 && isHighSurrogate(from.charCodeAt(prefix - 1)))
    prefix--
  let suffix = 0
  while (suffix < max - prefix && from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix))
    suffix++
  if (suffix > 0 && isLowSurrogate(from.charCodeAt(from.length - suffix)))
    suffix--
  const builder = new DeltaBuilder()
  builder.push({ retain: prefix })
  builder.push({ insert: to.slice(prefix, to.length - suffix) })
  builder.push({ delete: from.length - prefix - suffix })
  return builder.chop()
}
