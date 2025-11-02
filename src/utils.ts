import { defineLogger } from 'reactive-vscode'

export const logger = defineLogger('P2P Live Share')

export function useIdAllocator() {
  let id = 0
  return () => id++
}

export function normalizeUint8Array<T>(data: T): T {
  if (data instanceof Uint8Array) {
    if (data.constructor !== Uint8Array) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as any
    }
  }
  return data
}

export function lazy<T>(factory: () => T): () => T {
  let value: T | undefined
  return () => value ??= factory()
}

export class MapWithDefault<K, V> extends Map<K, V> {
  constructor(public defaultFactory: () => V) {
    super()
  }

  use(key: K): V {
    let value = this.get(key)
    if (!value) {
      value = this.defaultFactory()
      this.set(key, value)
    }
    return value
  }
}

export class ThrottledExecutor {
  private timeoutId: any | null = null
  private task: (() => void) | null = null

  constructor(private delay: number) {}

  schedule(task: () => void) {
    if (this.timeoutId == null) {
      task()
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null
        if (this.task) {
          this.task()
          this.task = null
        }
      }, this.delay)
    }
    else {
      this.task = task
    }
  }
}
