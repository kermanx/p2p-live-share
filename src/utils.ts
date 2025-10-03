import { defineLogger } from 'reactive-vscode'

export const logger = defineLogger('P2P Live Share')

export function useIdAllocator() {
  let id = 0
  return () => id++
}
