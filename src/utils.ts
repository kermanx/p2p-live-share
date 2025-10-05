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
