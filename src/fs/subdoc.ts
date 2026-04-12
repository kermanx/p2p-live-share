import * as Y from 'yjs'
import { normalizeUint8Array } from '../utils'

export function readContent(file: Y.Doc): Uint8Array {
  const map = file.getMap('content')
  const text = map.get('text') as Y.Text | undefined
  if (text) {
    return new TextEncoder().encode(text.toString())
  }
  return map.get('binary') as Uint8Array
}

export function writeContent(file: Y.Doc, content: Uint8Array | string, forceText = false) {
  const map = file.getMap('content')
  const oldText = map.get('text') as Y.Text | undefined
  const text = () => typeof content === 'string' ? content : new TextDecoder().decode(content)
  if (oldText) {
    oldText.delete(0, oldText.length)
    oldText.insert(0, text())
  }
  else if (typeof content === 'string' || content.length === 0 || forceText) {
    map.set('text', new Y.Text(text()))
    map.delete('binary')
  }
  else {
    map.set('binary', normalizeUint8Array(content))
    map.delete('text')
  }
}

export function asText(file: Y.Doc): Y.Text {
  const map = file.getMap('content')
  const binary = map.get('binary') as Uint8Array | undefined
  if (binary) {
    const text = new TextDecoder().decode(binary)
    map.set('text', new Y.Text(text))
    map.delete('binary')
  }
  return map.get('text') as Y.Text
}

export function isSameContent(file: Y.Doc, content: Uint8Array | string): boolean {
  const map = file.getMap('content')
  const text = map.get('text') as Y.Text | undefined
  if (text) {
    return text.toString() === (typeof content === 'string' ? content : new TextDecoder().decode(content))
  }
  const binary = map.get('binary') as Uint8Array | undefined
  return areUint8ArraysEqual(binary!, typeof content === 'string' ? new TextEncoder().encode(content) : content)

  function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array) {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
}

type Delta = Y.YEvent<any>['delta']
export function watchSubDocChanges(
  file: Y.Doc,
  onTextDelta: (delta: Delta) => void,
  onTotalChange: () => void,
) {
  const map = file.getMap('content')
  map.observeDeep((events) => {
    for (const event of events) {
      if (event.transaction.local)
        continue

      if (event.target instanceof Y.Text) {
        onTextDelta(event.delta)
      }
      else if (event.target instanceof Y.Map) {
        onTotalChange()
      }
      else {
        console.warn('Unexpected event target type in sub-document:', event.target)
      }
    }
  })
}
