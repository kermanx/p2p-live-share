import * as Y from 'yjs'

export class YTuple<T extends any[]> extends Y.Array<any> {
  constructor(...args: T) {
    super()
    this.push(args)
  }

  get<K extends Extract<keyof T, number>>(index: K): T[K] {
    return super.get(index) as T[K]
  }

  toArray(): T {
    return super.toArray() as T
  }
}
